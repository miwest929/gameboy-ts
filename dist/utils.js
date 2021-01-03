"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSigned = exports.bitNegation = exports.displayAsHex = exports.loadTextFile = exports.sleep = exports.uInt8ArrayToUtf8 = exports.multiDimRepeat = exports.arrayRepeat = exports.debugLog = void 0;
const textEncoding = __importStar(require("text-encoding")); // npm install --save @types/text-encoding
const fs = __importStar(require("fs"));
const VERBOSE_LOGGING = false;
function debugLog(log) {
    if (VERBOSE_LOGGING) {
        console.log(log);
    }
}
exports.debugLog = debugLog;
function arrayRepeat(value, times) {
    let arr = [];
    for (let i = 0; i < times; i++) {
        arr.push(value);
    }
    return arr;
}
exports.arrayRepeat = arrayRepeat;
function multiDimRepeat(value, rowCount, colCount) {
    let arr = [];
    for (let iy = 0; iy < rowCount; iy++) {
        arr.push(arrayRepeat(value, colCount));
    }
    return arr;
}
exports.multiDimRepeat = multiDimRepeat;
function uInt8ArrayToUtf8(bytes) {
    let utf8decoder = new textEncoding.TextDecoder();
    return utf8decoder.decode(bytes);
}
exports.uInt8ArrayToUtf8 = uInt8ArrayToUtf8;
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
exports.sleep = sleep;
function loadTextFile(filepath) {
    if (fs.readFileSync) {
        return fs.readFileSync(filepath, 'utf8');
    }
    return "";
}
exports.loadTextFile = loadTextFile;
function displayAsHex(n) {
    return `0x${n.toString(16)}`;
}
exports.displayAsHex = displayAsHex;
function bitNegation(value) {
    let binaryString = value.toString(2);
    let negatedBinary = "";
    for (let i = 0; i < binaryString.length; i++) {
        negatedBinary += binaryString[i] === '1' ? '0' : '1';
    }
    return parseInt(negatedBinary, 2);
}
exports.bitNegation = bitNegation;
function makeSigned(value, bytesCount) {
    let msbMask = 0x80;
    if (bytesCount === 2) {
        msbMask = 0x8000;
    }
    if ((value & msbMask) > 0) {
        // value is negative
        return -(bitNegation(value) + 1);
    }
    return value;
}
exports.makeSigned = makeSigned;
