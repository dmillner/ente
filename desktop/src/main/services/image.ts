/** @file Image format conversions and thumbnail generation */

import fs from "node:fs/promises";
import path from "node:path";
import { CustomErrorMessage, type ZipItem } from "../../types/ipc";
import log from "../log";
import { execAsync, isDev } from "../utils/electron";
import {
    deleteTempFileIgnoringErrors,
    makeFileForDataOrPathOrZipItem,
    makeTempFilePath,
} from "../utils/temp";

export const convertToJPEG = async (imageData: Uint8Array) => {
    const inputFilePath = await makeTempFilePath();
    const outputFilePath = await makeTempFilePath("jpeg");

    // Construct the command first, it may throw NotAvailable on win32.
    const command = convertToJPEGCommand(inputFilePath, outputFilePath);

    try {
        await fs.writeFile(inputFilePath, imageData);
        await execAsync(command);
        return new Uint8Array(await fs.readFile(outputFilePath));
    } finally {
        await deleteTempFileIgnoringErrors(inputFilePath);
        await deleteTempFileIgnoringErrors(outputFilePath);
    }
};

const convertToJPEGCommand = (
    inputFilePath: string,
    outputFilePath: string,
) => {
    switch (process.platform) {
        case "darwin":
            return [
                "sips",
                "-s",
                "format",
                "jpeg",
                inputFilePath,
                "--out",
                outputFilePath,
            ];

        case "linux":
            return [
                imageMagickPath(),
                inputFilePath,
                "-quality",
                "100%",
                outputFilePath,
            ];

        default: // "win32"
            throw new Error(CustomErrorMessage.NotAvailable);
    }
};

/** Path to the Linux image-magick executable bundled with our app */
const imageMagickPath = () =>
    path.join(isDev ? "build" : process.resourcesPath, "image-magick");

export const generateImageThumbnail = async (
    dataOrPathOrZipItem: Uint8Array | string | ZipItem,
    maxDimension: number,
    maxSize: number,
): Promise<Uint8Array> => {
    const {
        path: inputFilePath,
        isFileTemporary: isInputFileTemporary,
        writeToTemporaryFile: writeToTemporaryInputFile,
    } = await makeFileForDataOrPathOrZipItem(dataOrPathOrZipItem);

    const outputFilePath = await makeTempFilePath("jpeg");

    // Construct the command first, it may throw `NotAvailable`.
    let quality = 70;
    let command = generateImageThumbnailCommand(
        inputFilePath,
        outputFilePath,
        maxDimension,
        quality,
    );

    try {
        await writeToTemporaryInputFile();

        let thumbnail: Uint8Array;
        do {
            await execAsync(command);
            // TODO(MR): imagemagick debugging. Remove me after verifying logs.
            log.info(`Generated thumbnail using ${command.join(" ")}`);
            thumbnail = new Uint8Array(await fs.readFile(outputFilePath));
            quality -= 10;
            command = generateImageThumbnailCommand(
                inputFilePath,
                outputFilePath,
                maxDimension,
                quality,
            );
        } while (thumbnail.length > maxSize && quality > 50);
        return thumbnail;
    } finally {
        if (isInputFileTemporary)
            await deleteTempFileIgnoringErrors(inputFilePath);
        await deleteTempFileIgnoringErrors(outputFilePath);
    }
};

const generateImageThumbnailCommand = (
    inputFilePath: string,
    outputFilePath: string,
    maxDimension: number,
    quality: number,
) => {
    switch (process.platform) {
        case "darwin":
            return [
                "sips",
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                `${quality}`,
                "-Z",
                `${maxDimension}`,
                inputFilePath,
                "--out",
                outputFilePath,
            ];

        case "linux":
            // The bundled binary is an ELF x86-64 executable.
            if (process.arch != "x64")
                throw new Error(CustomErrorMessage.NotAvailable);
            return [
                imageMagickPath(),
                "-define",
                `jpeg:size=${2 * maxDimension}x${2 * maxDimension}`,
                inputFilePath,
                "-auto-orient",
                "-thumbnail",
                `${maxDimension}x${maxDimension}`,
                "-unsharp",
                "0x.5",
                "-quality",
                `${quality}`,
                outputFilePath,
            ];

        default: // "win32"
            throw new Error(CustomErrorMessage.NotAvailable);
    }
};
