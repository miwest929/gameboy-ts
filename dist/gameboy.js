"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const emulator_1 = require("./emulator");
const readlineSync = __importStar(require("readline-sync"));
function getCommandLineArguments() {
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
    const gameboy = new emulator_1.Gameboy(debugMode, readlineSync, isFrameExecution);
    const cart = new emulator_1.Cartridge(romFilename); // second arg is for fromLocalFileSystem
    await gameboy.loadCartridge(cart);
    console.log(cart.getRomHeaderInfo());
    console.log('Powered on. Executing rom program');
    gameboy.powerOn();
    gameboy.executeRom(); // TODO: Better interface is to pass the Cartridge instance to this function....
}
execute();
