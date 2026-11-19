declare module "utif" {
  export interface IFD {
    width: number;
    height: number;
    [key: string]: unknown;
  }
  const UTIF: {
    decode(buffer: ArrayBuffer): IFD[];
    decodeImage(buffer: ArrayBuffer, ifd: IFD, ifds?: IFD[]): void;
    toRGBA8(ifd: IFD): Uint8Array;
  };
  export default UTIF;
}
