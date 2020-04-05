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

const getOAMHtml = () => {
    let html = '';
    for (let objId = 39; objId >= 0; objId--) {
        const offset = 4 * objId;
        const oam = new OAMEntry([
            gameboy.ppu.oam[offset],
            gameboy.ppu.oam[offset + 1],
            gameboy.ppu.oam[offset + 2],
            gameboy.ppu.oam[offset + 3]
        ]);
        html += `<p class='regvalue'>X=${oam.x()}, Y=${oam.y()}, tileId=${oam.tileId()}, isXFlipped=${oam.isXFlipped()}, isYFlipped=${oam.isYFlipped()}<p>`;
    }
    return html;
}

const renderPPUInfo = () => {
    const isEmpty = $('#ppuInfo > div').length === 0;
    const ppuInfo = $('#ppuInfo');

    if (isEmpty) {
        ppuInfo.empty();
        ppuInfo.addClass('ppu-debug');
        ppuInfo.html(`
        <div><span class='regname'>LY</span><p class='regvalue' id='ly'>${gameboy.ppu.LY}</p></div>
        <div><span class='regname'>LX</span><p class='regvalue' id='lx'>${gameboy.ppu.LX}</p></div>
        <div><span class='regname'>LCDC</span><p class='regvalue' id='lcdc'>${gameboy.ppu.LCDC_REGISTER.RawValue}</p></div>
        <div><span class='regname'>OAM RAM</span>
            <div>
              ${getOAMHtml()}
            </div>
        </div>
        `);
    } else {
        $('#ly').text(gameboy.ppu.LY);
        $('#lx').text(gameboy.ppu.LX);
        $('#lcdc').text(gameboy.ppu.LCDC_REGISTER.RawValue);
    }
}

const renderCPUInfo = () => {
    const isEmpty = $('#cpuInfo > div').length === 0;
    const cpuElement = $('#cpuInfo');

    if (isEmpty) {
        cpuElement.empty();
        cpuElement.addClass('debug');
        cpuElement.html(`
          <div><span class='regname'>PC</span><p class='regvalue' id='pc'>${gameboy.cpu.PC}</p></div>
          <div><span class='regname'>SP</span><p class='regvalue' id='sp'>${gameboy.cpu.SP}</p></div>
          <div><span class='regname'>A</span><p class='regvalue' id='a'>${gameboy.cpu.A}</p></div>
          <div><span class='regname'>B</span><p class='regvalue' id='b'>${gameboy.cpu.B}</p></div>
          <div><span class='regname'>C</span><p class='regvalue' id='c'>${gameboy.cpu.C}</p></div>
          <div><span class='regname'>D</span><p class='regvalue' id='d'>${gameboy.cpu.D}</p></div>
          <div><span class='regname'>E</span><p class='regvalue' id='e'>${gameboy.cpu.E}</p></div>
          <div><span class='regname'>F</span><p class='regvalue' id='f'>${gameboy.cpu.F}</p></div>
        `);
    } else {
       $('#pc').text(gameboy.cpu.PC);
       $('#sp').text(gameboy.cpu.SP);
       $('#a').text(gameboy.cpu.A);
       $('#b').text(gameboy.cpu.B);
       $('#c').text(gameboy.cpu.C);
       $('#d').text(gameboy.cpu.D);
       $('#e').text(gameboy.cpu.E);
       $('#f').text(gameboy.cpu.F);
    }
}

function renderEmulatorInfo() {
    renderCPUInfo();
    renderPPUInfo();
}

function emulatorNextStep() {
    // TODO: Lame attempt at breakpoints
    // while (gameboy.cpu.PC <= 666) {
        gameboy.executeNextStep();
    // }
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