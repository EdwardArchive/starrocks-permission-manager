import { cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";
import type { RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

afterEach(() => {
  cleanup();
});

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { ...options });
}

export { customRender as render };
export { screen, waitFor, within, act } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
