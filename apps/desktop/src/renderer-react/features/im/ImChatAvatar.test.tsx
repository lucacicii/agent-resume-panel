import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImChatAvatar } from "./ImChatAvatar";

describe("ImChatAvatar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders empty placeholder when no roles are provided", () => {
    const { container } = render(<ImChatAvatar roles={[]} size={32} />);
    const avatar = container.querySelector(".im-chat-avatar.im-chat-avatar-empty");
    expect(avatar).not.toBeNull();
    expect(avatar?.textContent).toContain("#");
  });

  it("renders a single role filling the circle when 1 role is provided", () => {
    const roles = [{ templateId: "role_developer", name: "Developer" }];
    const { container } = render(<ImChatAvatar roles={roles} size={32} />);
    const avatar = container.querySelector(".im-chat-avatar");
    expect(avatar).not.toBeNull();
    const roleSpans = container.querySelectorAll(".im-chat-avatar-role");
    expect(roleSpans).toHaveLength(1);
    expect(roleSpans[0]?.textContent).toBe("D");
    expect((roleSpans[0] as HTMLElement).style.width).toBe("100%");
    expect((roleSpans[0] as HTMLElement).style.height).toBe("100%");
  });

  it("renders 2 overlapping small circles when 2 roles are provided", () => {
    const roles = [
      { templateId: "role_product_manager", name: "Product Manager" },
      { templateId: "role_developer", name: "Developer" }
    ];
    const { container } = render(<ImChatAvatar roles={roles} size={32} />);
    const roleSpans = container.querySelectorAll(".im-chat-avatar-role");
    expect(roleSpans).toHaveLength(2);
    expect(roleSpans[0]?.textContent).toBe("P");
    expect(roleSpans[1]?.textContent).toBe("D");
    expect((roleSpans[0] as HTMLElement).style.width).toBe("68%");
    expect((roleSpans[1] as HTMLElement).style.width).toBe("68%");
  });

  it("renders 3 overlapping small circles in a triangle layout for 3 roles", () => {
    const roles = [
      { templateId: "role_product_manager", name: "Product Manager" },
      { templateId: "role_architect", name: "Architect" },
      { templateId: "role_developer", name: "Developer" }
    ];
    const { container } = render(<ImChatAvatar roles={roles} size={32} />);
    const roleSpans = container.querySelectorAll(".im-chat-avatar-role");
    expect(roleSpans).toHaveLength(3);
    expect(roleSpans[0]?.textContent).toBe("P");
    expect(roleSpans[1]?.textContent).toBe("A");
    expect(roleSpans[2]?.textContent).toBe("D");
    expect((roleSpans[0] as HTMLElement).style.width).toBe("58%");
  });

  it("renders 4 overlapping small circles in a 2x2 cluster for 4 roles", () => {
    const roles = [
      { templateId: "role_product_manager", name: "Product Manager" },
      { templateId: "role_architect", name: "Architect" },
      { templateId: "role_developer", name: "Developer" },
      { templateId: "role_tester", name: "Tester" }
    ];
    const { container } = render(<ImChatAvatar roles={roles} size={32} />);
    const roleSpans = container.querySelectorAll(".im-chat-avatar-role");
    expect(roleSpans).toHaveLength(4);
    expect(roleSpans[0]?.textContent).toBe("P");
    expect(roleSpans[1]?.textContent).toBe("A");
    expect(roleSpans[2]?.textContent).toBe("D");
    expect(roleSpans[3]?.textContent).toBe("T");
    expect((roleSpans[0] as HTMLElement).style.width).toBe("54%");
  });

  it("renders 6 radial overlapping small circles for 6 roles", () => {
    const roles = [
      { templateId: "role_product_manager", name: "Product Manager" },
      { templateId: "role_architect", name: "Architect" },
      { templateId: "role_project_manager", name: "Project Manager" },
      { templateId: "role_ui_designer", name: "UI Designer" },
      { templateId: "role_developer", name: "Developer" },
      { templateId: "role_tester", name: "Tester" }
    ];
    const { container } = render(<ImChatAvatar roles={roles} size={36} />);
    const roleSpans = container.querySelectorAll(".im-chat-avatar-role");
    expect(roleSpans).toHaveLength(6);
    expect(roleSpans[0]?.textContent).toBe("P");
    expect(roleSpans[1]?.textContent).toBe("A");
    expect(roleSpans[2]?.textContent).toBe("P");
    expect(roleSpans[3]?.textContent).toBe("U");
    expect(roleSpans[4]?.textContent).toBe("D");
    expect(roleSpans[5]?.textContent).toBe("T");
  });

  it("dynamically adjusts when roles are added and removed", () => {
    const initialRoles = [
      { templateId: "role_developer", name: "Developer" },
      { templateId: "role_tester", name: "Tester" }
    ];
    const { container, rerender } = render(<ImChatAvatar roles={initialRoles} size={32} />);
    expect(container.querySelectorAll(".im-chat-avatar-role")).toHaveLength(2);

    // Add a role
    const threeRoles = [
      ...initialRoles,
      { templateId: "role_architect", name: "Architect" }
    ];
    rerender(<ImChatAvatar roles={threeRoles} size={32} />);
    expect(container.querySelectorAll(".im-chat-avatar-role")).toHaveLength(3);

    // Remove two roles -> 1 role left
    const oneRole = [{ templateId: "role_developer", name: "Developer" }];
    rerender(<ImChatAvatar roles={oneRole} size={32} />);
    const singleRoleSpans = container.querySelectorAll(".im-chat-avatar-role");
    expect(singleRoleSpans).toHaveLength(1);
    expect((singleRoleSpans[0] as HTMLElement).style.width).toBe("100%");

    // Remove all roles -> empty placeholder
    rerender(<ImChatAvatar roles={[]} size={32} />);
    expect(container.querySelectorAll(".im-chat-avatar-role")).toHaveLength(0);
    expect(container.querySelector(".im-chat-avatar.im-chat-avatar-empty")).not.toBeNull();
  });
});
