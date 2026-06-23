import { ImageResponse } from "next/og";

// Apple touch icon (180×180): the loop mark on the brand accent — same identity
// as the favicon, at the size iOS / link-unfurlers / wallet app cards want. A
// complete icon set is part of presenting as a legitimate, established dapp.
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
              width: 62,
              height: 62,
              borderRadius: 62,
              border: "22px solid #ffffff",
            }}
          />
          <div
            style={{
              width: 62,
              height: 62,
              borderRadius: 62,
              border: "22px solid #ffffff",
              marginLeft: -28,
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
