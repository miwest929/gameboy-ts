import { FlexLayout, QColor, WidgetEventTypes, QMainWindow, QPainter, QPoint, QWidget } from '@nodegui/nodegui';
import { multiDimRepeat } from './utils';

enum ScreenColor {
  BLACK = 0x00,
  LIGHT_GRAY = 0x01,
  DARK_GRAY = 0x02,
  WHITE = 0x03
}

const MAGNIFIED_LEVEL = 2;
const OFFSET_X = 20;
const OFFSET_Y = 20;
class GameboyScreen {
  static readonly WIDTH_IN_PIXELS: number = 160;
  static readonly HEIGHT_IN_PIXELS: number = 144;
  private pixels: ScreenColor[][];

  constructor() {
    this.pixels = multiDimRepeat(ScreenColor.BLACK, GameboyScreen.WIDTH_IN_PIXELS, GameboyScreen.HEIGHT_IN_PIXELS);
  }

  public render(window: QMainWindow) {
    const painter = new QPainter(window);

    for (let i = 0; i < this.pixels.length; i++) {
      for (let j = 0; j < this.pixels[i].length; j++) {
        this.renderSinglePixel(painter, MAGNIFIED_LEVEL, j * MAGNIFIED_LEVEL + OFFSET_X, i * MAGNIFIED_LEVEL + OFFSET_Y, this.toQColor(this.pixels[i][j]))
      }
    }

    painter.end();   
  }

  private toQColor(color: ScreenColor): QColor {
    return {
      [ScreenColor.BLACK]: new QColor(15, 56, 15),
      [ScreenColor.LIGHT_GRAY]: new QColor(139, 172, 15),
      [ScreenColor.DARK_GRAY]: new QColor(139, 172, 15),
      [ScreenColor.WHITE]: new QColor(155, 188, 15) 
    }[color];
  }

  private renderSinglePixel(painter: QPainter, magnified: number, x: number, y: number, color: QColor) {  
    const points = [
      new QPoint(x, y),
      new QPoint(x + magnified, y),
      new QPoint(x + magnified, y + magnified),
      new QPoint(x, y + magnified)
    ];

    painter.setPen(color);
    painter.setBrush(color);    
    painter.drawConvexPolygon(points);
  }
}

class EmulatorApplication {
  private window: QMainWindow;

  constructor(width: number, height: number) {
    this.window = new QMainWindow();
    this.initialize(width, height);
  }

  public start() {
    if (!this.window) {
      throw new Error("QMainWindow instance is not initialized");
    }

    this.window.show();
    (global as any).win = this.window;
  }

  public attachScreenRender(screen: GameboyScreen) {
    this.window.addEventListener(WidgetEventTypes.Paint, () => {
      screen.render(this.window);
    });    
  }

  private initialize(width: number, height: number) {
    const center = new QWidget();
    const layout = new FlexLayout();
    center.setLayout(layout);
    this.window.resize(width, height);
    this.window.setWindowTitle("Gameboy Emulator");
  }
}

async function run() {
  const screen = new GameboyScreen();
  const app = new EmulatorApplication(640, 480);
  app.attachScreenRender(screen);
  console.log('-------------------------------------------------------------')
  console.log("Starting the Gameboy Emulator...");
  app.start();
}

run();
