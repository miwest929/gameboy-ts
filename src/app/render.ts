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

const renderPPUInfo = () => {
    const ppuInfo = $('#ppuInfo');
    ppuInfo.empty();
    ppuInfo.html(`
      <div>LY = ${gameboy.ppu.LY}</div>
      <div>LX = ${gameboy.ppu.LX}</div>
      <div>LCDC = ${gameboy.ppu.LCDC}</div>
    `);
}

const renderCPUInfo = () => {
    const cpuElement = $('#cpuInfo');
    cpuElement.empty();
    cpuElement.html(`
      <div>PC = ${gameboy.cpu.PC}</div>
      <div>SP = ${gameboy.cpu.SP}</div>
      <div>A = ${gameboy.cpu.A}</div>
      <div>B = ${gameboy.cpu.B}</div>
      <div>C = ${gameboy.cpu.C}</div>
      <div>D = ${gameboy.cpu.D}</div>
      <div>E = ${gameboy.cpu.E}</div>
      <div>F = ${gameboy.cpu.F}</div>
    `);
}

const renderEmulatorInfo = () => {
    renderCPUInfo();
    renderPPUInfo();
}

const emulatorNextStep = () => {
    gameboy.executeNextStep();
}

const main = async () => {
    await gameboy.loadCartridge(cart);
    console.log(cart.getRomHeaderInfo());
    console.log('Powered on. Executing rom program');
    gameboy.powerOn();

    setInterval(renderEmulatorInfo, 40);

    const INSTRUCTIONS_PER_SECOND = 160;
    setInterval(emulatorNextStep, 3); //1000 / INSTRUCTIONS_PER_SECOND);
}

main();