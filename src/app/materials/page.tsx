import MaterialsClient, { type OfficialDoc } from "./MaterialsClient";
import { EXAM_FORMAT_DATA } from "@/lib/exam-formats";
import { MATERIALS_OFFICIAL_DOC_IDS } from "@/lib/materials-official-docs";

/**
 * /materials: server wrapper. The official documents shelf (G27) is projected
 * here from the sourced exam-format record, so the page shows each document's
 * own check date without shipping the whole record to the browser.
 */
export default function MaterialsPage() {
  const docs: OfficialDoc[] = MATERIALS_OFFICIAL_DOC_IDS.flatMap((id) => {
    const source = EXAM_FORMAT_DATA.sources[id];
    return source ? [{ id, url: source.url, label: source.label, verifiedOn: source.verifiedOn }] : [];
  });
  return <MaterialsClient officialDocs={docs} />;
}
