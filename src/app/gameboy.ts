import { Cartridge, Gameboy } from './emulator';

function getCommandLineArguments(): any[] {
    const args = process.argv.slice(2);
    if (args.length !== 1 && args.length !== 2) {
      // The second argument is optional
      // When provided it'll run the emulator in debug mode which for now
      // just means that the emulator's speed is reduced so we can more easily
      // track the stack of registers and memory
      console.log(`Usage: ts-node src/app/gameboy.ts <path-to-rom> [debug]`);
      return null;
    }
    
    return [args[0], args[1] === 'debug' ? true : false];
}

async function execute() {
  const [romFilename, debugMode] = getCommandLineArguments();
  if (!romFilename) {
      process.exit(1);
  }

  const gameboy = new Gameboy(debugMode);
  const cart = new Cartridge(romFilename); // second arg is for fromLocalFileSystem
  await gameboy.loadCartridge(cart);

  console.log(cart.getRomHeaderInfo());
  console.log('Powered on. Executing rom program');
  gameboy.powerOn();
  gameboy.executeRom();
}

execute();