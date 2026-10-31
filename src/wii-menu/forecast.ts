import type { Archive, ChannelBase } from './assets';
import type { Quad, Vec2 } from './lyt/brlyt';
import { AnimationPlayer, type LayoutInstance, type PaneNode } from './lyt/layout';

const FORECAST_ID = 'HAFE';
// On a console a module fills these in from WiiLink's forecast data; here it's a sunny afternoon in Redmond.
const CITY = 'Redmond';
const CONDITION = 'Sunny';
// WiiLink's "Sunny" carries mark 101, which is the sun alone at the center.
const SYMBOL = 'W_sun_00';
// About the Seattle area's normal daily highs in °F, January to December.
const HIGHS = [48, 50, 54, 59, 65, 71, 77, 78, 71, 60, 51, 46];
const TIME_ZONE = 'America/Los_Angeles';
const UPDATE_HOUR = 15;
// no_big.tpl is one row of cells: 0-9, °, −, C, F.
const NUMBER_CELLS = 14;
const DIGIT_WIDTH = 50;

/** icon.cs on a console with data: the sun and temperature, with icon_Rso0 cycling the Weathernews logo over them. */
export function forecastIcon(channel: ChannelBase, instance: LayoutInstance): AnimationPlayer | null {
  if (channel.id !== FORECAST_ID) return null;
  const text = `${latestForecast().fahrenheit}°F`;
  showSymbol(instance);
  for (const name of ['current_text', 'current_sdw']) instance.pane(name).text = text;
  return moduleClip(channel.icon, instance, 'icon').play();
}

/** banner.rso's worldwide layout on a USA console; its banner_Rso0 fades the forecast in once the zoom is over. */
export function forecastBanner(channel: ChannelBase, instance: LayoutInstance): AnimationPlayer | null {
  if (channel.id !== FORECAST_ID) return null;
  const { fahrenheit, stamp } = latestForecast();
  instance.pane('all').visible = true;
  instance.pane('textB0').visible = false;
  for (const name of ['city', 'city_sdw']) instance.pane(name).text = CITY;
  for (const name of ['telop', 'telop_sdw']) instance.pane(name).text = CONDITION;
  instance.pane('timeWW').text = stamp;
  showSymbol(instance);
  showTemperature(instance, fahrenheit);
  return moduleClip(channel.banner, instance, 'banner');
}

/** The most recent 3 p.m. in Redmond with that month's normal high, stamped as an English USA console writes it. */
function latestForecast(now = Date.now()): { fahrenheit: number; stamp: string } {
  let day = redmondClock(now);
  if (day.hour < UPDATE_HOUR) day = redmondClock(now - 24 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${UPDATE_HOUR % 12 || 12}:00 ${UPDATE_HOUR < 12 ? 'a.m.' : 'p.m.'}`;
  return {
    fahrenheit: HIGHS[day.month - 1],
    stamp: `As of ${time}, ${pad(day.month)}/${pad(day.day)}`,
  };
}

/** The date and hour on Redmond's clock, daylight saving and all. */
function redmondClock(time: number): { month: number; day: number; hour: number } {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(format.formatToParts(time).map((part) => [part.type, Number(part.value)]));
  return { month: parts.month, day: parts.day, hour: parts.hour };
}

/** A module's clip, bound to its Rso0 group as bindRsoAnm binds it, looping only if the file says so. */
function moduleClip(archive: Archive, instance: LayoutInstance, layout: string): AnimationPlayer {
  const animation = archive.animation(`${layout}_Rso0`)!;
  const panes = archive.layout(layout).groups.get('Rso0');
  return new AnimationPlayer(animation, instance, { panes, loop: animation.loop, wholeFrames: true });
}

/** Every weather symbol under `code` hides but the mark's own. */
function showSymbol(instance: LayoutInstance): void {
  for (const pane of instance.pane('code').children) {
    if (pane.name.startsWith('W_')) pane.visible = pane.name === SYMBOL;
  }
}

/** setup_ww_layout's big digits: leading zeros hide, and a USA console in Fahrenheit hides the F as well. */
function showTemperature(instance: LayoutInstance, degrees: number): void {
  const digits = String(degrees);
  ['kion_doF1', 'kion_doF10', 'kion_doF100'].forEach((name, place) => {
    const digit = digits[digits.length - 1 - place];
    const pane = instance.pane(name);
    pane.visible = digit !== undefined;
    if (digit !== undefined) showCell(pane, Number(digit));
  });
  instance.pane('kion_doF_F').visible = false;
  // Each hidden leading digit moves the group left by half a digit, and the hidden F moves it back right.
  instance.pane('kion_doF1').translate[0] += ((digits.length - 2) * DIGIT_WIDTH) / 2;
}

/** set_number_texture: the picture keeps its rows and takes one cell's columns of the strip. */
function showCell(pane: PaneNode, cell: number): void {
  pane.texCoords = pane.source.picture!.texCoords.map((quad) =>
    quad.map(([, t], corner): Vec2 => [(cell + (corner % 2)) / NUMBER_CELLS, t]) as Quad<Vec2>);
}
