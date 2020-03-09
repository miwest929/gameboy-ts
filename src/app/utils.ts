function arrayRepeat<T>(value: T, times: number): T[] {
	let arr = [];
	for (let i = 0; i < times; i++) {
  	  arr.push(value);
    }

    return arr;
}

function multiDimRepeat<T>(value: T, rowCount: number, colCount: number): T[][] {
    let arr = [];
    for (let iy = 0; iy < rowCount; iy++) {
        arr.push( arrayRepeat<T>(value, colCount) );
    }
    return arr;
}

function uInt8ArrayToUtf8(bytes: Uint8Array): string {
    let utf8decoder = new TextDecoder();
    return utf8decoder.decode(bytes);
}