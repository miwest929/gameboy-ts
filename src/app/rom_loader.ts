import * as fs from 'fs';

export function loadRomFromFileSystem(romName: string): Uint8Array {
  console.log(`Reading ROM bytes for rom ${romName}`);
  const buffer = fs.readFileSync(romName);
  return Uint8Array.from(buffer);
}