export function StatusBadge({value}: {value: string}) {
 const tone = ["VALID","POSTED","COMPLETE","APPROVED","CLOSED","REVIEWED","SENT","RESOLVED"].includes(value) ? "ok" : ["FAILED","REJECTED","ERROR","VOIDED"].includes(value) ? "error" : ["PENDING","SUBMITTED","INCOMPLETE","REVISION_REQUESTED"].includes(value) ? "warning" : "neutral";
 return <span className={"status-badge status-" + tone}>{value.replaceAll("_", " ")}</span>;
}
