import { createHash, randomInt } from 'node:crypto';

import undici from 'undici';

import cache from '@/utils/cache';

const ON_DEMAND_CHUNK_REGEX = /,(\d+):["']ondemand\.s["']/;
const INDICES_REGEX = /(\(\w\[(\d{1,2})\],\s*16\))+/g;
const DEFAULT_KEYWORD = 'obfiowerehiring';
const ADDITIONAL_RANDOM_NUMBER = 3;
const CACHE_KEY = 'twitter:client-transaction-data';

const round = (num: number) => {
    const x = Math.floor(num);
    return num - x >= 0.5 ? Math.ceil(num) : Math.sign(num) * x;
};

const floatToHex = (x: number) => {
    const result: string[] = [];
    let quotient = Math.trunc(x);
    let fraction = x - quotient;

    while (quotient > 0) {
        const newQuotient = Math.trunc(x / 16);
        const remainder = Math.trunc(x - newQuotient * 16);
        result.unshift(remainder > 9 ? String.fromCodePoint(remainder + 55) : String(remainder));
        x = newQuotient;
        quotient = newQuotient;
    }

    if (fraction === 0) {
        return result.join('');
    }

    result.push('.');
    while (fraction > 0) {
        fraction *= 16;
        const integer = Math.trunc(fraction);
        fraction -= integer;
        result.push(integer > 9 ? String.fromCodePoint(integer + 55) : String(integer));
    }

    return result.join('');
};

const isOdd = (num: number) => (num % 2 ? -1 : 0);

class Cubic {
    constructor(private curves: number[]) {}

    static calculate(a: number, b: number, m: number) {
        return 3 * a * (1 - m) * (1 - m) * m + 3 * b * (1 - m) * m * m + m * m * m;
    }

    getValue(time: number) {
        let startGradient = 0;
        let endGradient = 0;
        let start = 0;
        let mid = 0;
        let end = 1;

        if (time <= 0) {
            if (this.curves[0] > 0) {
                startGradient = this.curves[1] / this.curves[0];
            } else if (this.curves[1] === 0 && this.curves[2] > 0) {
                startGradient = this.curves[3] / this.curves[2];
            }
            return startGradient * time;
        }

        if (time >= 1) {
            if (this.curves[2] < 1) {
                endGradient = (this.curves[3] - 1) / (this.curves[2] - 1);
            } else if (this.curves[2] === 1 && this.curves[0] < 1) {
                endGradient = (this.curves[1] - 1) / (this.curves[0] - 1);
            }
            return 1 + endGradient * (time - 1);
        }

        while (start < end) {
            mid = (start + end) / 2;
            const xEstimate = Cubic.calculate(this.curves[0], this.curves[2], mid);
            if (Math.abs(time - xEstimate) < 0.00001) {
                return Cubic.calculate(this.curves[1], this.curves[3], mid);
            }
            if (xEstimate < time) {
                start = mid;
            } else {
                end = mid;
            }
        }

        return Cubic.calculate(this.curves[1], this.curves[3], mid);
    }
}

const interpolate = (from: number[], to: number[], f: number) => from.map((value, index) => value * (1 - f) + to[index] * f);

const convertRotationToMatrix = (rotation: number) => {
    const radians = (rotation * Math.PI) / 180;
    return [Math.cos(radians), -Math.sin(radians), Math.sin(radians), Math.cos(radians)];
};

type TransactionData = {
    key: string;
    keyBytes: number[];
    animationKey: string;
};

const getKey = (html: string) => {
    const match = html.match(/<meta[^>]*name=["']twitter-site-verification["'][^>]*content=["']([^"']+)["']/);
    if (!match) {
        throw new Error("Couldn't get twitter-site-verification key");
    }
    return match[1];
};

const getFrames = (html: string) =>
    html
        .matchAll(/id=["']loading-x-anim-\d+["'][\s\S]*?<\/svg>/g)
        .toArray()
        .map((match) => {
            const paths = match[0]
                .matchAll(/<path[^>]*d=["']([^"']+)["']/g)
                .toArray()
                .map((pathMatch) => pathMatch[1]);
            return paths[1] || paths[0];
        });

const getIndices = (ondemandJs: string) => {
    const indices = ondemandJs
        .matchAll(INDICES_REGEX)
        .toArray()
        .map((match) => Number(match[2]));
    if (indices.length === 0) {
        throw new Error("Couldn't get KEY_BYTE indices");
    }
    return [indices[0], indices.slice(1)] as const;
};

const getOndemandFileUrl = (html: string) => {
    const chunkId = html.match(ON_DEMAND_CHUNK_REGEX)?.[1];
    if (!chunkId) {
        throw new Error("Couldn't get ondemand.s chunk id");
    }

    const hash = html.match(new RegExp(`,${chunkId}:["']([0-9a-f]+)["']`))?.[1];
    if (!hash) {
        throw new Error("Couldn't get ondemand.s chunk hash");
    }

    return `https://abs.twimg.com/responsive-web/client-web/ondemand.s.${hash}a.js`;
};

const get2dArray = (keyBytes: number[], frames: string[]) => {
    const path = frames[keyBytes[5] % 4];
    return path
        .slice(9)
        .split('C')
        .map((item) => item.replaceAll(/\D+/g, ' ').trim().split(/\s+/).map(Number));
};

const solve = (value: number, minValue: number, maxValue: number, shouldFloor: boolean) => {
    const result = (value * (maxValue - minValue)) / 255 + minValue;
    return shouldFloor ? Math.floor(result) : Math.round(result * 100) / 100;
};

const animate = (frames: number[], targetTime: number) => {
    const fromColor = [...frames.slice(0, 3).map(Number), 1];
    const toColor = [...frames.slice(3, 6).map(Number), 1];
    const fromRotation = [0];
    const toRotation = [solve(frames[6], 60, 360, true)];
    const curves = frames.slice(7).map((value, index) => solve(value, isOdd(index), 1, false));
    const value = new Cubic(curves).getValue(targetTime);
    const color = interpolate(fromColor, toColor, value).map((value) => Math.max(0, Math.min(255, value)));
    const rotation = interpolate(fromRotation, toRotation, value);
    const matrix = convertRotationToMatrix(rotation[0]);

    const strArr = color.slice(0, -1).map((value) => Math.round(value).toString(16));
    for (const value of matrix) {
        const rounded = Math.abs(Math.round(value * 100) / 100);
        const hexValue = floatToHex(rounded);
        strArr.push(hexValue.startsWith('.') ? `0${hexValue}`.toLowerCase() : hexValue || '0');
    }
    strArr.push('0', '0');

    return strArr.join('').replaceAll(/[.-]/g, '');
};

const getAnimationKey = (keyBytes: number[], frames: string[], rowIndex: number, keyBytesIndices: number[]) => {
    const frameTime = keyBytesIndices.reduce((result, index) => result * (keyBytes[index] % 16), 1);
    const roundedFrameTime = round(frameTime / 10) * 10;
    const arr = get2dArray(keyBytes, frames);
    const frameRow = arr[(keyBytes[rowIndex] % 16) % arr.length];
    return animate(frameRow, roundedFrameTime / 4096);
};

const fetchTransactionData = async (dispatcher?: Dispatcher) => {
    const homeResponse = await undici.fetch('https://x.com', {
        dispatcher,
        headers: {
            'user-agent': 'Mozilla/5.0',
        },
    });
    const homeHtml = await homeResponse.text();
    const ondemandUrl = getOndemandFileUrl(homeHtml);
    const ondemandResponse = await undici.fetch(ondemandUrl, {
        headers: {
            'user-agent': 'Mozilla/5.0',
        },
    });
    const ondemandJs = await ondemandResponse.text();

    const [rowIndex, keyBytesIndices] = getIndices(ondemandJs);
    const key = getKey(homeHtml);
    const keyBytes = [...Buffer.from(key, 'base64')];
    const frames = getFrames(homeHtml);
    const animationKey = getAnimationKey(keyBytes, frames, rowIndex, keyBytesIndices);

    return { key, keyBytes, animationKey };
};

const getTransactionData = (dispatcher?: Dispatcher) => cache.tryGet(CACHE_KEY, () => fetchTransactionData(dispatcher), 60 * 60, false) as Promise<TransactionData>;

export const generateClientTransactionId = async (method: string, path: string, dispatcher?: Dispatcher) => {
    const { keyBytes, animationKey } = await getTransactionData(dispatcher);
    const timeNow = Math.floor((Date.now() - 1_682_924_400_000) / 1000);
    const timeBytes = Array.from({ length: 4 }, (_, index) => (timeNow >> (index * 8)) & 0xff);
    const hash = createHash('sha256').update(`${method}!${path}!${timeNow}${DEFAULT_KEYWORD}${animationKey}`).digest();
    const randomNumber = randomInt(0, 256);
    const bytes = [...keyBytes, ...timeBytes, ...hash.subarray(0, 16), ADDITIONAL_RANDOM_NUMBER];
    const output = [randomNumber, ...bytes.map((byte) => byte ^ randomNumber)];
    return Buffer.from(output).toString('base64').replaceAll(/=+$/g, '');
};

type Dispatcher = Parameters<typeof undici.fetch>[1]['dispatcher'];
