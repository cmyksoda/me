import type { Archive, Assets, Channel, ChannelBase } from './assets';
import type { Screen } from './display';
import { forecastBanner } from './forecast';
import { contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Sound } from './sound';
import { useWideTextures } from './wide';

export type PreviewButton = 'back' | 'download';

const OTHER_LANGUAGES = ['JPN', 'GER', 'FRA', 'SPA', 'ITA', 'NED', 'CHN', 'KOR'];
const CHANGE_FRAMES = 10;
// A banner waits for its sound so the two start together, but never longer than a second.
const SOUND_WAIT_FRAMES = 60;
// In 16:9 the frame pieces take the wide mask textures (ChannelTitle's scWidePanes).
const WIDE_FRAME_TEXTURES: [string, string[]][] = [
  ['Picture_04', ['Fre_a', 'Fre_d', 'Fre_i', 'Fre_l']],
  ['Picture_05', ['Fre_e', 'Fre_f', 'Fre_g', 'Fre_h']],
  ['Picture_06', ['Fre_b', 'Fre_c', 'Fre_j', 'Fre_k']],
];

/** The button bar a preview wears (the Wii Menu's or the SD Card Menu's) and where its banner sounds live. */
export interface PreviewStyle {
  archive: Archive;
  layout: string;
  back: string;
  sounds: string;
}

interface Banner<C> {
  channel: C;
  instance: LayoutInstance;
  start: AnimationPlayer | null;
  loop: AnimationPlayer | null;
}

/** The channel preview (iplChannelTitle.cpp): a channel's banner under the Back and Download buttons. */
export class Preview<C extends ChannelBase = Channel> {
  hovered: PreviewButton | null = null;
  private readonly frame: LayoutInstance;
  private readonly clips: Record<string, AnimationPlayer>;
  private readonly style: PreviewStyle;
  private banner: Banner<C>;
  private next: C | null = null;
  private downloadOn = true;
  private changing = 0;
  private starting: { delay: number; waited: number } | null = null;
  private wide = false;

  constructor(
    private readonly assets: Assets,
    private readonly renderer: Renderer,
    private readonly sound: Sound,
    channel: C,
    style?: PreviewStyle,
  ) {
    this.style = style ?? { archive: assets.menu.chanTtl, layout: 'my_ChTop_a', back: 'Back', sounds: 'channels' };
    const { archive, layout } = this.style;
    this.frame = archive.instance(layout);
    this.frame.pane('T_BtnA').text = this.style.back;
    this.frame.pane('T_BtnB').text = 'Download';
    const groups = this.frame.layout.groups;
    const clip = (file: string, group: string) => new AnimationPlayer(
      archive.animation(`${layout}_${file}`)!, this.frame, { panes: groups.get(group) ?? [] },
    );
    this.clips = {
      onBack: clip('FocusBtn_on', 'G_FocusBtnA'),
      offBack: clip('FocusBtnA_off', 'G_FocusBtnA'),
      onDownload: clip('FocusBtn_on', 'G_FocusBtnB'),
      offDownload: clip('FocusBtnA_off', 'G_FocusBtnB'),
      pressBack: clip('SelectBtn_Ac', 'G_SelectBtnA'),
      pressDownload: clip('SelectBtn_Ac', 'G_SelectBtnB'),
      dimDownload: clip('OffBtn', 'G_OnOffBtnB'),
      lightDownload: clip('OnBtn', 'G_OnOffBtnB'),
    };
    this.banner = this.load(channel);
    this.sound.prepareBanner(this.folder(channel));
  }

  private folder(channel: C): string {
    return `${this.style.sounds}/${channel.id}`;
  }

  get channel(): C {
    return this.banner.channel;
  }

  /** Grays the Download button out (OffBtn) or lights it again (OnBtn), as changeStartButton does for Start. */
  setDownload(on: boolean, instant = false): void {
    if (on === this.downloadOn) return;
    this.downloadOn = on;
    if (!on && this.hovered === 'download') this.point(null);
    const clip = this.clips[on ? 'lightDownload' : 'dimDownload'];
    if (instant) clip.seek(clip.to);
    else clip.play();
  }

  private load(channel: C): Banner<C> {
    const instance = channel.banner.instance('banner');
    for (const language of OTHER_LANGUAGES) {
      for (const name of channel.banner.layout('banner').groups.get(language) ?? []) {
        const pane = instance.panes.get(name);
        if (pane) pane.visible = false;
      }
    }
    const animation = (name: string, loop: boolean) => {
      const data = channel.banner.animation(name);
      return data ? new AnimationPlayer(data, instance, { loop, wholeFrames: true }) : null;
    };
    const start = animation('banner_Start', false) ?? forecastBanner(channel, instance);
    const loop = animation('banner_Loop', true) ?? animation('banner', true);
    // The zoom shows the banner's first frame; it only starts moving once the zoom has finished.
    (start ?? loop)?.seek(0);
    return { channel, instance, start, loop };
  }

  /** Zoom finished (calcFadein): the banner's Start clip, or its loop, begins with its sound. */
  begin(soundDelay = 0): void {
    this.starting = { delay: soundDelay, waited: 0 };
    this.tryStart(0);
  }

  /** Leaving the preview: a banner still waiting for its sound doesn't start on the way out. */
  halt(): void {
    this.starting = null;
  }

  private tryStart(frames: number): void {
    const starting = this.starting!;
    starting.waited += frames;
    const folder = this.folder(this.banner.channel);
    if (!this.sound.bannerReady(folder) && starting.waited < SOUND_WAIT_FRAMES) return;
    this.starting = null;
    if (this.banner.start) this.banner.start.play();
    else this.banner.loop?.play();
    this.sound.playBanner(folder, starting.delay);
  }

  /** Previous/next: the old banner plays on for 10 updates, then the new one holds for 10 before it starts. */
  change(channel: C): void {
    if (this.changing) return;
    this.starting = null;
    this.sound.prepareBanner(this.folder(channel));
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
    // A grayed-out Download takes no hover, only its gray press.
    if (button === 'download' && !this.downloadOn) button = null;
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
    const order = ['dimDownload', 'lightDownload', 'offBack', 'offDownload', 'onBack', 'onDownload', 'pressBack', 'pressDownload'];
    for (const name of order) this.clips[name].step(frames);
    if (this.starting) this.tryStart(frames);
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
      useWideTextures(this.frame, WIDE_FRAME_TEXTURES, screen.wide);
    }
    const view = identity();
    this.banner.instance.update(view, screen);
    this.renderer.drawLayout(this.banner.instance);
    this.frame.update(view, screen);
    this.renderer.drawLayout(this.frame);
  }
}
