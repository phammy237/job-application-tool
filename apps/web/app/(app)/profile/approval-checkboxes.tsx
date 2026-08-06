/**
 * The three flags every approvable record carries (docs/DATA_MODEL.md "Two-layer fact
 * model"). Rendered together everywhere a fact/experience/education/project can be edited so
 * the approve-before-use model in docs/AI_GROUNDING.md is visible, not implicit.
 */
export function ApprovalCheckboxes({
  defaultApproved,
  defaultApprovedForApplications,
  defaultVisible,
}: {
  defaultApproved: boolean;
  defaultApprovedForApplications: boolean;
  defaultVisible: boolean;
}) {
  return (
    <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          name="userApproved"
          defaultChecked={defaultApproved}
          className="border-input h-3.5 w-3.5 rounded"
        />
        Approved
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          name="approvedForApplications"
          defaultChecked={defaultApprovedForApplications}
          className="border-input h-3.5 w-3.5 rounded"
        />
        Usable in AI suggestions
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          name="visibleOnPublicProfile"
          defaultChecked={defaultVisible}
          className="border-input h-3.5 w-3.5 rounded"
        />
        Visible on public profile
      </label>
    </div>
  );
}
