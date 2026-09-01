import { type CSSProperties, type JSX, useMemo } from "react";
import { roleColor, roleInitial } from "./imUtils";

export interface ImChatAvatarRole {
  templateId: string;
  name?: string;
  label?: string;
}

export interface ImChatAvatarProps {
  roles?: ImChatAvatarRole[];
  size?: number;
  className?: string;
  title?: string;
}

interface CircleLayout {
  top?: string;
  left?: string;
  bottom?: string;
  right?: string;
  width: string;
  height: string;
  zIndex: number;
}

function computeLayouts(count: number): { layouts: CircleLayout[]; fontSizeRatio: number } {
  if (count <= 1) {
    return {
      layouts: [{ top: "0%", left: "0%", width: "100%", height: "100%", zIndex: 1 }],
      fontSizeRatio: 0.44
    };
  }

  if (count === 2) {
    return {
      layouts: [
        { top: "0%", left: "0%", width: "68%", height: "68%", zIndex: 1 },
        { bottom: "0%", right: "0%", width: "68%", height: "68%", zIndex: 2 }
      ],
      fontSizeRatio: 0.28
    };
  }

  if (count === 3) {
    return {
      layouts: [
        { top: "0%", left: "21%", width: "58%", height: "58%", zIndex: 1 },
        { bottom: "1%", left: "1%", width: "58%", height: "58%", zIndex: 2 },
        { bottom: "1%", right: "1%", width: "58%", height: "58%", zIndex: 3 }
      ],
      fontSizeRatio: 0.24
    };
  }

  if (count === 4) {
    return {
      layouts: [
        { top: "0%", left: "0%", width: "54%", height: "54%", zIndex: 1 },
        { top: "0%", right: "0%", width: "54%", height: "54%", zIndex: 2 },
        { bottom: "0%", left: "0%", width: "54%", height: "54%", zIndex: 3 },
        { bottom: "0%", right: "0%", width: "54%", height: "54%", zIndex: 4 }
      ],
      fontSizeRatio: 0.22
    };
  }

  if (count === 5) {
    const d = 48;
    const r = 27;
    const angles = [-90, -18, 54, 126, 198];
    const layouts: CircleLayout[] = angles.map((deg, index) => {
      const rad = (deg * Math.PI) / 180;
      const cx = 50 + r * Math.cos(rad);
      const cy = 50 + r * Math.sin(rad);
      return {
        left: `${(cx - d / 2).toFixed(2)}%`,
        top: `${(cy - d / 2).toFixed(2)}%`,
        width: `${d}%`,
        height: `${d}%`,
        zIndex: index + 1
      };
    });
    return { layouts, fontSizeRatio: 0.19 };
  }

  // count >= 6: Radial circular arrangement
  const d = Math.max(34, 44 - (count - 6) * 2);
  const r = 50 - d / 2;
  const step = 360 / count;
  const layouts: CircleLayout[] = Array.from({ length: count }, (_, index) => {
    const deg = -90 + index * step;
    const rad = (deg * Math.PI) / 180;
    const cx = 50 + r * Math.cos(rad);
    const cy = 50 + r * Math.sin(rad);
    return {
      left: `${(cx - d / 2).toFixed(2)}%`,
      top: `${(cy - d / 2).toFixed(2)}%`,
      width: `${d}%`,
      height: `${d}%`,
      zIndex: index + 1
    };
  });
  const fontSizeRatio = Math.max(0.14, 0.17 - (count - 6) * 0.01);
  return { layouts, fontSizeRatio };
}

export function ImChatAvatar({
  roles = [],
  size = 28,
  className = "",
  title
}: ImChatAvatarProps): JSX.Element {
  const visibleRoles = roles;
  const count = visibleRoles.length;
  const { layouts, fontSizeRatio } = useMemo(() => computeLayouts(count), [count]);
  const fontSizePx = Math.max(6, Math.round(size * fontSizeRatio));

  const defaultTitle = useMemo(() => {
    if (title) return title;
    if (visibleRoles.length === 0) return "Chat";
    return visibleRoles.map((r) => r.label || r.name || r.templateId).join(", ");
  }, [title, visibleRoles]);

  if (count === 0) {
    return (
      <div
        className={`im-chat-avatar im-chat-avatar-empty ${className}`.trim()}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        title={defaultTitle}
        aria-label={defaultTitle}
      >
        <span className="im-chat-avatar-placeholder" aria-hidden="true" style={{ fontSize: `${Math.round(size * 0.45)}px` }}>
          #
        </span>
      </div>
    );
  }

  return (
    <div
      className={`im-chat-avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        fontSize: `${fontSizePx}px`
      }}
      title={defaultTitle}
      aria-label={defaultTitle}
    >
      {visibleRoles.map((role, idx) => {
        const layout = layouts[idx] || layouts[0];
        const initial = roleInitial(role.label || role.name || role.templateId);
        const bg = roleColor(role.templateId);
        const roleStyle: CSSProperties = {
          position: "absolute",
          top: layout.top,
          left: layout.left,
          bottom: layout.bottom,
          right: layout.right,
          width: layout.width,
          height: layout.height,
          zIndex: layout.zIndex,
          backgroundColor: bg,
          "--im-role-color": bg
        } as CSSProperties;

        return (
          <span
            key={`${role.templateId}-${idx}`}
            className="im-chat-avatar-role"
            style={roleStyle}
            aria-hidden="true"
          >
            {initial}
          </span>
        );
      })}
    </div>
  );
}
