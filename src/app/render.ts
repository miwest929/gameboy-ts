let canvas:HTMLCanvasElement = document.getElementById('canvas') as HTMLCanvasElement;
let ctx:CanvasRenderingContext2D = canvas.getContext('2d');

function renderGameboyScreenBuffer(buffer: IScreenBuffer, startX: number, startY: number) {
    const canvasBuffer: ICanvasElementBuffer = getPixelBufferForCanvasElement(buffer);
    for (let iy = 0; iy < buffer.heightInPx; iy++) {
        for (let ix = 0; ix < buffer.widthInPx; ix++) {
            ctx.fillStyle = canvasBuffer.canvasData[iy][ix];
            ctx.fillRect(startX + ix * 4, startY + iy * 4, canvasBuffer.scalingFactorInPx, canvasBuffer.scalingFactorInPx);
        }
    }
}

function render(ctx: CanvasRenderingContext2D, screenBuffer: IScreenBuffer) {
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    renderGameboyScreenBuffer(screenBuffer, 180, 62);
}

const gameboy = new Gameboy();
const cart = new Cartridge('tetris');

const main = async () => {
    await gameboy.loadCartridge(cart);
    console.log(cart.getRomHeaderInfo());

    const worker = new Worker(emulatorWorkerCode); //'emulator_worker.js');
    worker.onmessage = (e) => {
      const buffer = e.data.buffer;
      render(ctx, buffer);
    };
    gameboy.powerOn();
    worker.postMessage({gameboy: gameboy});
}

main();