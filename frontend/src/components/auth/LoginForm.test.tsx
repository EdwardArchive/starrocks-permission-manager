import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "../../test/test-utils";
import userEvent from "@testing-library/user-event";
import LoginForm from "./LoginForm";

// Mock nodeIcons to avoid SVG ?raw imports in test environment
vi.mock("../dag/nodeIcons", () => ({
  APP_LOGO_SVG: '<svg width="24" height="24"></svg>',
  NODE_SVG_RAW: {},
  colorizedSvg: () => "",
}));

const mockSetAuth = vi.fn();
const mockSetConnectionInfo = vi.fn();

vi.mock("../../stores/authStore", () => ({
  useAuthStore: vi.fn(() => ({
    setAuth: mockSetAuth,
    setConnectionInfo: mockSetConnectionInfo,
  })),
}));

const mockLogin = vi.fn();
const mockGetMe = vi.fn();

vi.mock("../../api/auth", () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockLogin.mockReset();
  mockGetMe.mockReset();
});

describe("LoginForm", () => {
  it("renders all form fields", () => {
    render(<LoginForm />);

    expect(screen.getByPlaceholderText("192.168.1.100")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("9030")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("admin")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
  });

  it("has default port value 9030", () => {
    render(<LoginForm />);

    const portInput = screen.getByPlaceholderText("9030") as HTMLInputElement;
    expect(portInput.value).toBe("9030");
  });

  it("renders the title and subtitle", () => {
    render(<LoginForm />);

    expect(screen.getByText("StarRocks Permission Manager")).toBeInTheDocument();
    expect(
      screen.getByText("Connect to a StarRocks cluster to visually explore permissions"),
    ).toBeInTheDocument();
  });

  it("renders the submit button with 'Connect & Login' text", () => {
    render(<LoginForm />);

    expect(screen.getByRole("button", { name: "Connect & Login" })).toBeInTheDocument();
  });

  it("calls login, getMe, setConnectionInfo, and setAuth on successful submit", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ token: "jwt-123", username: "admin", roles: [], default_role: null });
    mockGetMe.mockResolvedValue({ username: "admin", roles: [], default_role: null, is_user_admin: true });

    render(<LoginForm />);

    await user.type(screen.getByPlaceholderText("192.168.1.100"), "10.0.0.1");
    await user.clear(screen.getByPlaceholderText("9030"));
    await user.type(screen.getByPlaceholderText("9030"), "9030");
    await user.type(screen.getByPlaceholderText("admin"), "root");
    await user.type(screen.getByPlaceholderText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Connect & Login" }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        host: "10.0.0.1",
        port: 9030,
        username: "root",
        password: "secret",
      });
    });

    await waitFor(() => {
      expect(mockGetMe).toHaveBeenCalled();
      expect(mockSetConnectionInfo).toHaveBeenCalledWith("10.0.0.1", 9030);
      expect(mockSetAuth).toHaveBeenCalledWith("jwt-123", {
        username: "admin",
        roles: [],
        default_role: null,
        is_user_admin: true,
      });
    });
  });

  it("displays error message when login fails", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new Error("Connection refused"));

    render(<LoginForm />);

    await user.type(screen.getByPlaceholderText("192.168.1.100"), "bad-host");
    await user.type(screen.getByPlaceholderText("admin"), "root");
    await user.type(screen.getByPlaceholderText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Connect & Login" }));

    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });
  });

  it("shows 'Connecting...' while loading", async () => {
    const user = userEvent.setup();
    // Never resolve so the loading state persists
    mockLogin.mockReturnValue(new Promise(() => {}));

    render(<LoginForm />);

    await user.type(screen.getByPlaceholderText("192.168.1.100"), "host");
    await user.type(screen.getByPlaceholderText("admin"), "root");
    await user.type(screen.getByPlaceholderText("Password"), "pass");
    await user.click(screen.getByRole("button", { name: "Connect & Login" }));

    await waitFor(() => {
      expect(screen.getByText("Connecting...")).toBeInTheDocument();
    });
  });
});
