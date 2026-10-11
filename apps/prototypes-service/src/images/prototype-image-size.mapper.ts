import { Injectable } from "@nestjs/common";
import type { PrototypeVisualDevice } from "@levantamiento-rq/shared-contracts";

export type PrototypeProviderImageSize = "1536x1024" | "1024x1536";
@Injectable()
export class PrototypeImageSizeMapper {
  forDevice(device: PrototypeVisualDevice): PrototypeProviderImageSize {
    return device === "WEB" ? "1536x1024" : "1024x1536";
  }
}
