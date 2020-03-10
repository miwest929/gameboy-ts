// This web worker is given an instance of Gameboy which it'll power on
// and let run in background.
// 30 times a second it'll post video data back to its caller
const REFRESH_HERTZ_PER_SECOND = 30;
const INSTRUCTIONS_PER_SECOND = 160;
const workerCode = `
onmessage = (e) => {
    console.log('Powering on the Gameboy');
    importScripts('http://localhost:8082/ppu.js');
    importScripts('http://localhost:8082/emulator.js');

    let gameboy = e.data.gameboy;
    gameboy.__proto__ = Gameboy.prototype;
    gameboy.cpu.__proto__ = CPU.prototype;
    gameboy.bus.__proto__ = MemoryBus.prototype;
    gameboy.memory.__proto__ = Memory.prototype;

    //gameboy.powerOn();

    //setInterval(() => {
    //  postMessage({buffer: gameboy.getScreenBuffer()}, "*"); // last arg is for targetOrigin. A value of "*" indicates 'no preference'
    //}, 1000.0 / ${REFRESH_HERTZ_PER_SECOND});

    console.log('Powered on. Executing rom program');

    const cpuLoopId = setInterval(() => {
      const cycles = gameboy.executeNextStep();
      if (cycles === 0) {
        console.log("CPU failed. Shutting down.");
        clearInterval(cpuLoopId);
      }
    }, 1000.0 / ${INSTRUCTIONS_PER_SECOND});
}`;

const emulatorWorkerCode = URL.createObjectURL(new Blob([workerCode]));