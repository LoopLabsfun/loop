import { ImageResponse } from "next/og";

// App favicon: the loop mark (two overlapping rings) on the brand accent.
export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#5b34d6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex" }}>
          <div
            style={{
              width: 11,
              height: 11,
              borderRadius: 11,
              border: "4px solid #ffffff",
            }}
          />
          <div
            style={{
              width: 11,
              height: 11,
              borderRadius: 11,
              border: "4px solid #ffffff",
              marginLeft: -5,
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
