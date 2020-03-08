// Prepares GB VRAM to be displayed in a canvas element
// Gameboy resolution is 160x144
// Each GB pixel is rendered as 4x4 in the browser
// So final resolution is (160 * 4)x(144 * 4) = 640x576

//import { multiDimRepeat } from './utils';
//import { IScreenBuffer } from './ppu';

const SCALING_FACTOR_IN_PX = 4; // 1 gameboy pixel is rendered as a 4x4 square in the browser
interface ICanvasElementBuffer {
    scalingFactorInPx: number;
    originalScreenBuffer: IScreenBuffer;
    canvasData: string[][];
}

const getPixelBufferForCanvasElement = (buffer: IScreenBuffer): ICanvasElementBuffer => {
  let data = emptyCanvasBuffer("rgb(0, 0, 0)", buffer.widthInPx * SCALING_FACTOR_IN_PX, buffer.heightInPx * SCALING_FACTOR_IN_PX);
  for (let iy = 0; iy < buffer.heightInPx; iy++) {
    for (let ix = 0; ix < buffer.widthInPx; ix++) {
      const pixel = buffer.data[iy][ix];
      data[iy][ix] = gameboyColorToRGBColor(pixel);
    }
  }

  return {
    scalingFactorInPx: SCALING_FACTOR_IN_PX,
    originalScreenBuffer: buffer,
    canvasData: data
  };
};

const gameboyColorToRGBColor = (gbPixel: number) => {
  const pixelMap = {
    0: "rgb(15, 56, 15)",
    1: "rgb(48, 98, 48)",
    2: "rgb(139, 172, 15)",
    3: "rgb(155, 188, 15)",
  };
  return pixelMap[gbPixel];
};

const emptyCanvasBuffer = (emptyColor: string, widthInPx: number, heightInPx: number): string[][] => {
  return multiDimRepeat<string>(emptyColor, heightInPx, widthInPx);
};