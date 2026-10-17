// @vitest-environment jsdom
/**
 * @layer dashboard-component AC-BLS3B-9 (NewDocModal; the AC's first oracle is the assets distribution suite)
 * NewDocModal spec-parent contract (AC-BLS3B-9, BR-1 / BR-2 / AS-18).
 *
 * A spec takes no parent — it relates to the trees by citing rules. The new
 * document form must therefore never ask for a parent on a spec, must not
 * show a parent field for one even when a parent was typed under another
 * type first, and must tell the author to cite rules. A task still requires
 * its parent (regression).
 *
 * Note: spec creation stays CLI/skill-only (adr-newdocmodal-spec-create-cli-skill-only-authoring-disable)
 * because the spec-create gate needs a skeleton + `lore ac add` criteria; that
 * is unchanged and pinned by NewDocModal.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewDocModal } from "../../src/components/NewDocModal";

function renderModal() {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(<NewDocModal onCreate={onCreate} isPending={false} error={null} onClose={vi.fn()} />);
  return { onCreate };
}

async function selectType(user: ReturnType<typeof userEvent.setup>, type: string): Promise<void> {
  await user.selectOptions(screen.getByLabelText("Type"), type);
}

describe("NewDocModal spec takes no parent (AC-BLS3B-9)", () => {
  it("does not render a Parent ID field for a spec", async () => {
    const user = userEvent.setup();
    renderModal();
    await selectType(user, "spec");
    expect(screen.queryByLabelText(/Parent ID/)).not.toBeInTheDocument();
  });

  it("still renders a required Parent ID field for a task (regression)", async () => {
    const user = userEvent.setup();
    renderModal();
    await selectType(user, "task");
    expect(screen.getByLabelText(/Parent ID/)).toBeInTheDocument();
  });

  it("drops a parent typed under task when the type switches to spec, and never submits one", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderModal();
    await selectType(user, "task");
    await user.type(screen.getByLabelText(/Parent ID/), "plan-x");
    await selectType(user, "spec");
    expect(screen.queryByLabelText(/Parent ID/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Title/), "A spec");
    // submitting is CLI-only; a forced submit must not send anything
    await user.keyboard("{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("tells the author to cite rules, not to pick a parent", async () => {
    const user = userEvent.setup();
    renderModal();
    await selectType(user, "spec");
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/cite/i);
    expect(notice).not.toHaveTextContent(/parent/i);
  });
});
