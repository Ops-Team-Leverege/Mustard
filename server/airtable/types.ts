/**
 * Airtable Integration Types
 * 
 * Purpose:
 * Type definitions for the PitCrew Product Database in Airtable.
 * These types represent the product source of truth data.
 * 
 * Tables:
 * - Value Propositions: WHY PitCrew matters
 * - Features: WHAT PitCrew does
 * - Value Themes: Groups of value propositions
 * - Feature Themes: Groups of features by function
 * - Customer Segments: Target customer segments
 * 
 * Layer: Airtable (type definitions)
 */

export type AirtableRecord<T> = {
  id: string;
  createdTime: string;
  fields: T;
};

export type ValuePropositionFields = {
  Name: string;
  "Value to Customer"?: number;
  Description?: string;
  "Internal Notes"?: string;
  Features?: string[];
  "Most Applicable to These Segments"?: string[];
  "Requires POS Integration?"?: boolean;
  "Value Themes"?: string[];
};

export type ValueThemeFields = {
  Name: string;
  Description?: string;
  "Value Propositions"?: string[];
};

export type FeatureFields = {
  Name: string;
  "List Order for Pricing Guide"?: number;
  "Value Propositions"?: string[];
  "Hide from Pricing List"?: boolean;
  "Product Status"?: "Available Now" | "In Development" | "Planned" | "Deprecated";
  "Description (Pricing Guide - External Facing)"?: string;
  "Pro Tier"?: string;
  "Advanced Tier"?: string;
  "Enterprise Tier"?: string;
  "Internal Notes"?: string;
  "Feature Themes"?: string[];
  Type?: "Feature" | "Add-On";
};

export type FeatureThemeFields = {
  Name: string;
  Description?: string;
  Features?: string[];
  Notes?: string;
};

export type CustomerSegmentFields = {
  Name: string;
  "Value Propositions"?: string[];
};

export type AirtableTableConfig = {
  tableId: string;
  tableName: string;
};

export const AIRTABLE_TABLES = {
  valuePropositions: { tableId: "tblV3tnJoE2AQ6NWw", tableName: "Value Propositions" },
  valueThemes: { tableId: "tblutbJnarZcdZzzz", tableName: "Value Themes" },
  features: { tableId: "tbljqXVPi195csdF1", tableName: "Features" },
  featureThemes: { tableId: "tblconzpfckWIV8JI", tableName: "Feature Themes" },
  customerSegments: { tableId: "tbldkMFWIrWRIxakC", tableName: "Customer Segments" },
} as const;
