import type { LayoutInstance } from './lyt/layout';

/** Copies the 16:9 textures from donor panes onto the panes they stand in for, or puts the 4:3 ones back. */
export function useWideTextures(instance: LayoutInstance, donors: [string, string[]][], wide: boolean): void {
  for (const [donor, targets] of donors) {
    const wideTexture = instance.materials[instance.pane(donor).source.picture!.material].textures[0];
    for (const target of targets) {
      const material = instance.materials[instance.pane(target).source.picture!.material];
      material.textures[0] = wide ? wideTexture : instance.layout.textures[material.source.texMaps[0].texture];
    }
  }
}
