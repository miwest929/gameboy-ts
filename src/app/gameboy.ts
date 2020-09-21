import { Cartridge, Gameboy } from './emulator';
import * as readlineSync from "readline-sync";

function getCommandLineArguments(): any[] {
    const args = process.argv.slice(2);
    if (args.length !== 1 && args.length !== 2) {
      // The second argument is optional
      // When provided it'll run the emulator in debug mode which for now
      // just means that the emulator's speed is reduced so we can more easily
      // track the stack of registers and memory
      console.log(`Usage: ts-node src/app/gameboy.ts <path-to-rom> [debug | frame]`);
      return null;
    }
  
    // Frame execution will keep executing instructions until the next frame is ready for rendering.
    // The debug console will have paused execution at this point.
    const isFrameExecution = args[1] === 'frame';
    const isDebugMode = ['debug', 'frame'].includes(args[1]);

    return [args[0], isDebugMode, isFrameExecution];
}

async function execute() {
  const [romFilename, debugMode, isFrameExecution] = getCommandLineArguments();
  if (!romFilename) {
      process.exit(1);
  }

  const gameboy = new Gameboy({inDebugMode: debugMode, readlineSync: readlineSync, inFrameExecutionMode: isFrameExecution});
  const cart = new Cartridge(romFilename); // second arg is for fromLocalFileSystem
  await gameboy.loadCartridge(cart);

  console.log(cart.getRomHeaderInfo());
  console.log('Powered on. Executing rom program');
  gameboy.powerOn();
  gameboy.executeRom(); // TODO: Better interface is to pass the Cartridge instance to this function....
}

execute();