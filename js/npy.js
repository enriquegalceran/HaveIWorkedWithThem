/* =========================================================
   npy.js — minimal parser for reading a .npy file in the browser.

   Supports 1-D numeric arrays (int8/16/32/64, uint8/16/32/64,
   float32/64), little- and big-endian. That covers the common
   cases numpy.save() produces. Does not support object arrays,
   structured dtypes, or Fortran-ordered multi-dim arrays.
   ========================================================= */

function parseNpy(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Magic string: \x93NUMPY
  const magic = String.fromCharCode(...bytes.slice(1, 6));
  if (bytes[0] !== 0x93 || magic !== "NUMPY") {
    throw new Error("Not a valid .npy file (bad magic bytes)");
  }

  const majorVersion = bytes[6];
  let headerLen, headerStart;

  if (majorVersion === 1) {
    headerLen = view.getUint16(8, true);
    headerStart = 10;
  } else {
    // version 2.x / 3.x use a 4-byte header length
    headerLen = view.getUint32(8, true);
    headerStart = 12;
  }

  const headerBytes = bytes.slice(headerStart, headerStart + headerLen);
  const headerStr = new TextDecoder("latin1").decode(headerBytes);

  const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  const fortranMatch = headerStr.match(/'fortran_order':\s*(True|False)/);

  if (!descrMatch || !shapeMatch) {
    throw new Error("Could not parse .npy header: " + headerStr);
  }

  const descr = descrMatch[1]; // e.g. "<i4", "<i8", "|u1"
  const fortranOrder = fortranMatch ? fortranMatch[1] === "True" : false;
  const shape = shapeMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);

  if (shape.length > 1 && fortranOrder) {
    throw new Error("Fortran-ordered multi-dimensional arrays are not supported");
  }

  const byteOrderChar = descr[0]; // '<' little, '>' big, '=' native, '|' n/a
  const typeChar = descr[1];      // 'i','u','f'
  const itemSize = parseInt(descr.slice(2), 10);
  const littleEndian = byteOrderChar !== ">";

  const dataStart = headerStart + headerLen;
  const totalElements = shape.reduce((a, b) => a * b, 1);

  const data = readTypedArray(
    arrayBuffer,
    dataStart,
    totalElements,
    typeChar,
    itemSize,
    littleEndian
  );

  return { dtype: descr, shape, data };
}

function readTypedArray(buffer, byteOffset, count, typeChar, itemSize, littleEndian) {
  const nativeLittleEndian = isNativeLittleEndian();

  // Fast path: byte order matches the platform's native order, and the
  // buffer is aligned, so we can construct a TypedArray view directly.
  if (littleEndian === nativeLittleEndian && byteOffset % itemSize === 0) {
    if (typeChar === "i" && itemSize === 1) return new Int8Array(buffer, byteOffset, count);
    if (typeChar === "i" && itemSize === 2) return new Int16Array(buffer, byteOffset, count);
    if (typeChar === "i" && itemSize === 4) return new Int32Array(buffer, byteOffset, count);
    if (typeChar === "u" && itemSize === 1) return new Uint8Array(buffer, byteOffset, count);
    if (typeChar === "u" && itemSize === 2) return new Uint16Array(buffer, byteOffset, count);
    if (typeChar === "u" && itemSize === 4) return new Uint32Array(buffer, byteOffset, count);
    if (typeChar === "f" && itemSize === 4) return new Float32Array(buffer, byteOffset, count);
    if (typeChar === "f" && itemSize === 8) return new Float64Array(buffer, byteOffset, count);
    // 64-bit ints fall through to the manual path below, since we convert
    // them to a plain Float64Array of Numbers for easy use elsewhere.
  }

  // Slow path: wrong endianness, misaligned, or 64-bit ints that need
  // conversion to JS-safe numbers. Reads element by element via DataView.
  const view = new DataView(buffer);
  const out = (typeChar === "f" && itemSize === 8)
    ? new Float64Array(count)
    : (itemSize === 8 ? new Float64Array(count) : new Float64Array(count));

  let warnedPrecision = false;

  for (let i = 0; i < count; i++) {
    const off = byteOffset + i * itemSize;
    let value;
    if (typeChar === "i") {
      if (itemSize === 1) value = view.getInt8(off);
      else if (itemSize === 2) value = view.getInt16(off, littleEndian);
      else if (itemSize === 4) value = view.getInt32(off, littleEndian);
      else if (itemSize === 8) {
        const big = view.getBigInt64(off, littleEndian);
        if (!warnedPrecision && (big > 9007199254740991n || big < -9007199254740991n)) {
          console.warn("npy.js: int64 value exceeds safe integer range, precision may be lost");
          warnedPrecision = true;
        }
        value = Number(big);
      }
    } else if (typeChar === "u") {
      if (itemSize === 1) value = view.getUint8(off);
      else if (itemSize === 2) value = view.getUint16(off, littleEndian);
      else if (itemSize === 4) value = view.getUint32(off, littleEndian);
      else if (itemSize === 8) {
        const big = view.getBigUint64(off, littleEndian);
        if (!warnedPrecision && big > 9007199254740991n) {
          console.warn("npy.js: uint64 value exceeds safe integer range, precision may be lost");
          warnedPrecision = true;
        }
        value = Number(big);
      }
    } else if (typeChar === "f") {
      value = itemSize === 4 ? view.getFloat32(off, littleEndian) : view.getFloat64(off, littleEndian);
    } else {
      throw new Error("Unsupported dtype character: " + typeChar);
    }
    out[i] = value;
  }

  return out;
}

function isNativeLittleEndian() {
  const buf = new ArrayBuffer(2);
  new Uint16Array(buf)[0] = 1;
  return new Uint8Array(buf)[0] === 1;
}
