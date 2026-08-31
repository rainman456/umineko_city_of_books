export const USERNAME_CHARS = "a-zA-Z0-9_";
export const MENTION_SOURCE = `@[${USERNAME_CHARS}]+(?:-[${USERNAME_CHARS}]+)*`;

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMentionMatcher(username: string | undefined): ((body: string) => boolean) | null {
    if (!username) {
        return null;
    }
    const re = new RegExp(`(?<![${USERNAME_CHARS}-])@${escapeRegex(username)}(?![${USERNAME_CHARS}-])`, "i");
    return body => re.test(body);
}
