/**
 * Prompt Version Tracker
 * 
 * Tracks which prompt versions are used during an interaction.
 * Accumulates versions throughout the pipeline and returns them for logging.
 */

import type { PromptVersions } from "../config/prompts/versions";

export type PromptUsageRecord = Partial<Record<keyof PromptVersions, string>>;

export class PromptVersionTracker {
    private versions: PromptUsageRecord = {};

    /**
     * Record that a prompt was used in this interaction.
     */
    track(promptName: keyof PromptVersions, version: string): void {
        this.versions[promptName] = version;
    }

    /**
     * Get all tracked prompt versions.
     */
    getVersions(): PromptUsageRecord {
        return { ...this.versions };
    }

    /**
     * Check if any prompts have been tracked.
     */
    hasVersions(): boolean {
        return Object.keys(this.versions).length > 0;
    }

    /**
     * Merge versions from another tracker (useful for combining sub-operations).
     */
    merge(other: PromptVersionTracker): void {
        this.versions = { ...this.versions, ...other.versions };
    }
}
