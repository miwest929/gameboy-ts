import { Cartridge, Gameboy } from './emulator';

function getCommandLineArguments(): string {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
      console.log(`Usage: ts-node src/app/gameboy.ts <path-to-rom>`);
      return null;
    }

    return args[0];
}

async function execute() {
  const romFilename = getCommandLineArguments();
  if (!romFilename) {
      process.exit(1);
  }

  const gameboy = new Gameboy();
  const cart = new Cartridge(romFilename, true); // second arg is for fromLocalFileSystem
  await gameboy.loadCartridge(cart);

  console.log(cart.getRomHeaderInfo());
  console.log('Powered on. Executing rom program');
  gameboy.powerOn();
  gameboy.executeRom();
}

execute();