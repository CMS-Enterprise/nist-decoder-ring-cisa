/**
 * The cake's chip for a control, for a dialog to give focus back to when it closes.
 * Matched by `data-control-chip`, not by link: a chip a Zero Trust filter matches only
 * through an enhancement links to the enhancement's address. A dimmed chip is inert
 * and cannot take focus, so it does not count.
 */
export function chipFor(id: string): HTMLElement | null {
  const chip = Array.from(
    document.querySelectorAll<HTMLElement>("[data-control-chip]"),
  ).find((el) => el.dataset.controlChip === id);
  return chip && !chip.closest("[inert]") ? chip : null;
}
