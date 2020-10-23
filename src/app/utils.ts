import * as textEncoding from 'text-encoding'; // npm install --save @types/text-encoding
import * as fs from 'fs';

export function arrayRepeat<T>(value: T, times: number): T[] {
	let arr = [];
	for (let i = 0; i < times; i++) {
  	  arr.push(value);
    }

    return arr;
}

export function multiDimRepeat<T>(value: T, rowCount: number, colCount: number): T[][] {
    let arr = [];
    for (let iy = 0; iy < rowCount; iy++) {
        arr.push( arrayRepeat<T>(value, colCount) );
    }

    return arr;
}

export function uInt8ArrayToUtf8(bytes: Uint8Array): string {
    let utf8decoder = new textEncoding.TextDecoder();
    return utf8decoder.decode(bytes);
}

export function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
}

export function loadTextFile(filepath: string) {
    if (fs.readFileSync) {
        return fs.readFileSync(filepath, 'utf8');
    }

    return "";
}

export function displayAsHex(n: number) {
    return `0x${n.toString(16)}`;
}

export function bitNegation(value: number): number {
    let binaryString: string = value.toString(2);
    let negatedBinary: string = "";
    for (let i = 0; i < binaryString.length; i++) {
        negatedBinary += binaryString[i] === '1' ? '0' : '1';
    }
    return parseInt(negatedBinary, 2);
}

export function makeSigned(value: number, bytesCount: number): number {
    let msbMask: number = 0x80;
    if (bytesCount === 2) {
        msbMask = 0x8000;
    }
    
    if ((value & msbMask) > 0) {
      // value is negative
      return -(bitNegation(value) + 1);
    }
  
    return value;
  }