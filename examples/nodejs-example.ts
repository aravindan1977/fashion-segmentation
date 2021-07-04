/**
 * This example loads 4 images of the same fashion item
 * and sends the to the served model.
 */

import * as path from 'path';
import * as fs from 'fs';
import sharp, { Sharp } from 'sharp';
import got from 'got';
import { clearFolder } from './util';
import { Dimensions } from './types';


const imagesDir = path.join(__dirname, './images');
console.log('imagesDir: ' + imagesDir);
const outputDir = path.join(__dirname, '../', 'output');

/**
 * If you need a model with higher resolution you can contact me.
 * (check the README.md)
 */
const singleImageSize = 512;
const singeImageDimensions: Dimensions = {
    width: singleImageSize,
    height: singleImageSize
};

async function run() {
    await clearFolder(outputDir);

    const imageFileNames = fs
        .readdirSync(imagesDir)
        .filter(name => name.endsWith('.jpg'));
    if (imageFileNames.length < 4) {
        throw new Error('folder has too less images ' + imagesDir + ', you need at least 4 of them');
    }

    const imageBuffers = await Promise.all(
        imageFileNames.map(async (imageFileName, idx) => {
            const imagePath = path.join(imagesDir, imageFileName);
            console.log('imagePath: ' + imagePath);
            const image = await sharp(imagePath);
            const resized = await resizeToDimension(image, singeImageDimensions);

            return resized.toBuffer();
        })
    );


    const inputImageWidth = singleImageSize * 2;

    /**
     * blend images clockwise
     * into a single image that contains all 4 images.
     * This combined image can be send as input to the trained model.
     */
    const endInputImage = sharp({
        create: {
            width: inputImageWidth,
            height: inputImageWidth,
            background: 'white',
            channels: 3
        }
    }).composite(
        [
            {
                input: imageBuffers[0],
                top: 0,
                left: 0
            },
            {
                input: imageBuffers[1],
                top: 0,
                left: singleImageSize
            },
            {
                input: imageBuffers[2],
                top: singleImageSize,
                left: 0
            },
            {
                input: imageBuffers[3],
                top: singleImageSize,
                left: singleImageSize
            }
        ]
    ).jpeg({
        quality: 100,
        chromaSubsampling: '4:4:4'
    });

    /**
     * the tensorflow server needs the images as json pixels
     * @link https://stackoverflow.com/a/58674728/3443137
     */
    function imgToJson(buffer): any[] {
        const decoded: any[] = [];
        let b = 0;
        for (let h = 0; h < inputImageWidth; h++) {
            let line: any[] = [];
            for (let w = 0; w < inputImageWidth; w++) {
                let pixel: any[] = [];

                pixel.push(buffer[b++] / 255.0); /* r */
                pixel.push(buffer[b++] / 255.0); /* g */
                pixel.push(buffer[b++] / 255.0); /* b */

                line.push(pixel);
            }
            decoded.push(line);
        }
        return decoded;
    }

    const endInputImageBuffer = await endInputImage
        .clone()
        .removeAlpha()
        .raw()
        .toBuffer();
    const imageAsJson = imgToJson(endInputImageBuffer);

    const tensorflowServerUrl = 'http://localhost:8501/v1/models/trained_model:predict';

    let outputPixels: number[][] = [];
    try {
        const { body } = await got.post(tensorflowServerUrl, {
            json: {
                instances: [{ 'input_1': imageAsJson }]
            },
            responseType: 'json'
        }) as any;
        console.log('# output from the model:');
        outputPixels = body.predictions[0];
    } catch (error) {
        console.error('# request failed');
        console.dir(error.response.body);
        throw error;
    }

    const rawPixels: number[] = [];
    outputPixels.forEach(row => {
        row.forEach(nr => {
            if (nr > 0.5) {
                rawPixels.push(0);
                rawPixels.push(0);
                rawPixels.push(0);
            } else {
                rawPixels.push(255);
                rawPixels.push(255);
                rawPixels.push(255);
            }
        });
    });


    console.log('# save output bitmap');
    const testOutputPath = path.join(outputDir, './bitmap.jpg');
    await sharp(Buffer.from(rawPixels), {
        raw: {
            width: inputImageWidth,
            height: inputImageWidth,
            channels: 3
        }
    }).toFile(testOutputPath);
    await endInputImage.toFile(path.join(outputDir, './input.jpg'));


    console.log('# get an image that only contains segmentated pixels');
    const segmentationPixels: number[] = [];
    let i = 0;
    outputPixels.forEach(row => {
        row.forEach(nr => {
            if (nr > 0.5) {
                segmentationPixels.push(255);
                segmentationPixels.push(255);
                segmentationPixels.push(255);
            } else {
                segmentationPixels.push(endInputImageBuffer[i]);
                segmentationPixels.push(endInputImageBuffer[i + 1]);
                segmentationPixels.push(endInputImageBuffer[i + 2]);
            }
            i = i + 3;
        });
    });
    await sharp(Buffer.from(segmentationPixels), {
        raw: {
            width: inputImageWidth,
            height: inputImageWidth,
            channels: 3
        }
    }).toFile(path.join(outputDir, './segmentated.jpg'));


    console.log(' DONE! check the output folder at ' + outputDir);

}


run();



/**
 * Resize the image so it fits into the given dimensions.
 * Fills the empty space with white color.
 */
export async function resizeToDimension(
    img: Sharp,
    dimensions: Dimensions
): Promise<Sharp> {
    return img
        .resize({
            background: '#ffffff',
            fit: 'contain',
            height: dimensions.height,
            width: dimensions.width
        })
        .jpeg({
            quality: 100,
            chromaSubsampling: '4:4:4'
        })
}