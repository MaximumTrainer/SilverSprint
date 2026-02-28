export class IntervalsCustomStreams {
  public static generateNFIStreamPayload(nfiValues: number[]) {
    return { name: "Neural Fatigue Index", short_name: "NFI", units: "index", data: nfiValues, color: "#FF4500" };
  }
}