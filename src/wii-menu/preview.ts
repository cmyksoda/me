import type { Assets, Channel } from './assets';
import type { Screen } from './display';
import { contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Sound } from './sound';

export type PreviewButton = 'back' | 'download';

const OTHER_LANGUAGES = ['JPN', 'GER', 'FRA', 'SPA', 'ITA', 'NED', 'CHN', 'KOR'];
const CHANGE_FRAMES = 10;
// In 16:9 the frame pieces take the wide mask textures (ChannelTitle's scWidePanes).
const WIDE_FRAME_TEXTURES: [string, string[]][] = [
  ['Picture_04', ['Fre_a', 'Fre_d', 'Fre_i', 'Fre_l']],
  ['Picture_05', ['Fre_e', 'Fre_f', 'Fre_g', 'Fre_h']],
  ['Picture_06', ['Fre_b', 'Fre_c', 'Fre_j', 'Fre_k']],
];

interface Banner {
  channel: Channel;
  instance: LayoutInstance;
  start: AnimationPlayer | null;
  loop: AnimationPlayer | null;
}

/** The channel preview (iplChannelTitle.cpp): a channel's banner under the Back and Download buttons. */
export class Preview {
  hovered: PreviewButton | null = null;
  private readonly frame: LayoutInstance;
  private readonly clips: Record<string, AnimationPlayer>;
  private banner: Banner;
  private next: Channel | null = null;
  private changing = 0;
  private wide = false;

  constructor(
    private readonly assets: Assets,
    private readonly renderer: Renderer,
    private readonly sound: Sound,
    channel: Channel,
  ) {
    const chanTtl = assets.menu.chanTtl;
    this.frame = chanTtl.instance('my_ChTop_a');
    this.frame.pane('T_BtnA').text = 'Back';
    this.frame.pane('T_BtnB').text = 'Download';
    const groups = this.frame.layout.groups;
    const clip = (file: string, group: string) => new AnimationPlayer(
      chanTtl.animation(`my_ChTop_a_${file}`)!, this.frame, { panes: groups.get(group) ?? [] },
    );
    this.clips = {
      onBack: clip('FocusBtn_on', 'G_FocusBtnA'),
      offBack: clip('FocusBtnA_off', 'G_FocusBtnA'),
      onDownload: clip('FocusBtn_on', 'G_FocusBtnB'),
      offDownload: clip('FocusBtnA_off', 'G_FocusBtnB'),
      pressBack: clip('SelectBtn_Ac', 'G_SelectBtnA'),
      pressDownload: clip('SelectBtn_Ac', 'G_SelectBtnB'),
    };
    this.banner = this.load(channel);
  }

  get channel(): Channel {
    return this.banner.channel;
  }

  private load(channel: Channel): Banner {
    const instance = channel.banner.instance('banner');
    for (const language of OTHER_LANGUAGES) {
      for (const name of channel.banner.layout('banner').groups.get(language) ?? []) {
        const pane = instance.panes.get(name);
        if (pane) pane.visible = false;
      }
    }
    const animation = (name: string, loop: boolean) => {
      const data = channel.banner.animation(name);
      return data ? new AnimationPlayer(data, instance, { loop }) : null;
    };
    const start = animation('banner_Start', false);
    const loop = animation('banner_Loop', true) ?? animation('banner', true);
    // The zoom shows the banner's first frame; it only starts moving once the zoom has finished.
    (start ?? loop)?.seek(0);
    return { channel, instance, start, loop };
  }

  /** Zoom finished (calcFadein): the banner's Start clip, or its loop, begins with its sound. */
  begin(): void {
    if (this.banner.start) this.banner.start.play();
    else this.banner.loop?.play();
    this.sound.playBanner(this.banner.channel);
  }

  /** Previous/next: the old banner plays on for 10 updates, then the new one holds for 10 before it starts. */
  change(channel: Channel): void {
    if (this.changing) return;
    this.next = channel;
    this.changing = CHANGE_FRAMES * 2;
    this.release();
  }

  get busy(): boolean {
    return this.changing > 0;
  }

  hit(x: number, y: number): PreviewButton | null {
    if (contains(this.frame.pane('B_BtnB'), x, y)) return 'download';
    if (contains(this.frame.pane('B_BtnA'), x, y)) return 'back';
    return null;
  }

  point(button: PreviewButton | null): void {
    if (button === this.hovered) return;
    if (this.hovered) this.clips[this.hovered === 'back' ? 'offBack' : 'offDownload'].play();
    this.hovered = button;
    if (button) {
      this.clips[button === 'back' ? 'onBack' : 'onDownload'].play();
      this.sound.play('WIPL_SE_BT_TARGETTING');
    }
  }

  press(button: PreviewButton): void {
    this.clips[button === 'back' ? 'pressBack' : 'pressDownload'].play();
    this.sound.play(button === 'back' ? 'WIPL_SE_BT_PUSH' : 'WIPL_SE_DECIDE');
  }

  release(): void {
    this.point(null);
  }

  update(frames: number): void {
    // Both focus clips sit on one pane; the "on" clip, bound later, wins while it plays.
    for (const name of ['offBack', 'offDownload', 'onBack', 'onDownload', 'pressBack', 'pressDownload']) {
      this.clips[name].step(frames);
    }
    const banner = this.banner;
    banner.start?.step(frames);
    if (banner.start && !banner.start.playing && banner.loop && !banner.loop.playing && banner.start.frame > 0) {
      banner.start = null;
      banner.loop.play();
    }
    banner.loop?.step(frames);

    if (this.changing > 0) {
      const before = this.changing;
      this.changing = Math.max(0, this.changing - frames);
      if (before > CHANGE_FRAMES && this.changing <= CHANGE_FRAMES && this.next) {
        this.sound.stopBanner();
        this.banner = this.load(this.next);
        this.next = null;
      }
      if (this.changing === 0) this.begin();
    }
  }

  draw(screen: Screen): void {
    if (screen.wide !== this.wide) {
      this.wide = screen.wide;
      if (screen.wide) {
        for (const [donor, targets] of WIDE_FRAME_TEXTURES) {
          const texture = this.frame.materials[this.frame.pane(donor).source.picture!.material].textures[0];
          for (const target of targets) {
            this.frame.materials[this.frame.pane(target).source.picture!.material].textures[0] = texture;
          }
        }
      }
    }
    const view = identity();
    this.banner.instance.update(view, screen);
    this.renderer.drawLayout(this.banner.instance);
    this.frame.update(view, screen);
    this.renderer.drawLayout(this.frame);
  }
}
