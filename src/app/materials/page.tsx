import MaterialsClient, { type OfficialDoc } from "./MaterialsClient";
import { EXAM_FORMAT_DATA } from "@/lib/exam-formats";

/**
 * /materials: server wrapper. The official documents shelf (G27) is projected
 * here from the sourced exam-format record, so the page shows each document's
 * own check date without shipping the whole record to the browser.
 */
const DOC_IDS = ["source-03", "source-15", "source-04", "source-12", "source-21", "source-08", "source-14", "source-16"] as const;

export default function MaterialsPage() {
  const docs: OfficialDoc[] = DOC_IDS.flatMap((id) => {
    const source = EXAM_FORMAT_DATA.sources[id];
    return source ? [{ id, url: source.url, label: source.label, verifiedOn: source.verifiedOn }] : [];
  });
  return <MaterialsClient officialDocs={docs} />;
}
