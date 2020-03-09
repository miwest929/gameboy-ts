//import { getPixelBufferForCanvasElement, ICanvasElementBuffer } from './screen_renderer';
//import { PPU, IScreenBuffer } from './ppu';

let canvas:HTMLCanvasElement = document.getElementById('canvas') as HTMLCanvasElement;
let ctx:CanvasRenderingContext2D = canvas.getContext('2d');


const ppu = new PPU();

function renderGameboyScreenBuffer(buffer: IScreenBuffer, startX: number, startY: number) {
    const canvasBuffer: ICanvasElementBuffer = getPixelBufferForCanvasElement(buffer);
    for (let iy = 0; iy < buffer.heightInPx; iy++) {
        for (let ix = 0; ix < buffer.widthInPx; ix++) {
            ctx.fillStyle = canvasBuffer.canvasData[iy][ix];
            ctx.fillRect(startX + ix * 4, startY + iy * 4, canvasBuffer.scalingFactorInPx, canvasBuffer.scalingFactorInPx);
        }
    }
}

function render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const screenBuffer: IScreenBuffer = ppu.getScreenBufferData();
    renderGameboyScreenBuffer(screenBuffer, 180, 62);
}

function gameLoop() {
    render(ctx);
    window.requestAnimationFrame(gameLoop);
}

const gameboy = new Gameboy();
const cart = new Cartridge('tetris');

const main = async () => {
    await gameboy.loadCartridge(cart);
    console.log(cart.getRomHeaderInfo());
    gameboy.powerOn();

    gameLoop();
}
main();