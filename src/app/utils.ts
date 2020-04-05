import * as textEncoding from 'text-encoding'; // npm install --save @types/text-encoding

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