import type { Database } from "@/types/database";

type DocumentType = Database["public"]["Enums"]["verification_document_type"];
type DocumentStatus = Database["public"]["Enums"]["verification_status"];

export const documentTypeLabels: Record<DocumentType, string> = {
  cac_certificate: "CAC registration certificate",
  national_id: "National ID (NIN slip or card)",
  drivers_license: "Driver’s licence",
  international_passport: "International passport",
  voters_card: "Voter’s card",
  utility_bill: "Utility bill (proof of address)",
  professional_license: "Professional licence or certification",
  other: "Other",
};

export const documentStatusInfo: Record<
  DocumentStatus,
  { label: string; tone: "neutral" | "accent" | "verified" | "danger" }
> = {
  pending: { label: "Waiting for review", tone: "accent" },
  approved: { label: "Accepted", tone: "verified" },
  rejected: { label: "Not accepted", tone: "danger" },
  needs_more_info: { label: "More information needed", tone: "accent" },
};
