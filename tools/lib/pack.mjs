/**
 * Lossless transport packing for the runtime GLBs. Geometry, skins and animation keys go through
 * the meshopt codec (EXT_meshopt_compression) without quantization, so every value decodes
 * bit-identical; textures become lossless WebP (EXT_texture_webp). three.js decodes both
 * (GLTFLoader + MeshoptDecoder), so models render pixel-identical at far fewer bytes, which matters
 * most for the single-file standalone build (no HTTP compression there).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

/** NodeIO that reads and writes packed files. */
export async function packIO() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

/** True when a document is already packed. */
export const isPacked = (doc) => doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression');

/** Marks a document for meshopt buffers on write and re-encodes PNG textures as lossless WebP. */
export async function packDocument(doc) {
  for (const tex of doc.getRoot().listTextures()) {
    if (tex.getMimeType() !== 'image/png') continue;
    const webp = await sharp(tex.getImage()).webp({ lossless: true, effort: 6, exact: true }).toBuffer();
    tex.setImage(new Uint8Array(webp)).setMimeType('image/webp');
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.png$/i, '.webp'));
  }
  if (doc.getRoot().listTextures().some((t) => t.getMimeType() === 'image/webp')) doc.createExtension(EXTTextureWebP).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}
