# Design Guidelines: BD Transcript Analyzer

## Design Approach

**Selected Approach:** Modern SaaS Design System (inspired by Linear, Notion, and Carbon Design)

**Rationale:** This is a data-intensive productivity tool requiring clarity, efficient information hierarchy, and strong focus on tabular data. The design prioritizes rapid data scanning, clear categorization, and minimal cognitive load for analyzing multiple transcripts.

**Core Principles:**
- Data clarity over decoration
- Strong visual hierarchy for quick scanning
- Generous whitespace around dense information
- Consistent, predictable patterns throughout

---

## Color Palette

### Dark Mode (Primary)
- **Background:** 220 15% 12% (deep slate)
- **Surface:** 220 13% 18% (elevated panels)
- **Surface Elevated:** 220 13% 22% (cards, tables)
- **Border:** 220 13% 28% (subtle dividers)
- **Text Primary:** 220 10% 95%
- **Text Secondary:** 220 8% 70%
- **Text Muted:** 220 8% 50%

### Accent Colors
- **Primary:** 220 90% 56% (vibrant blue - CTAs, active states)
- **Success:** 142 71% 45% (category matches, confirmations)
- **Warning:** 38 92% 50% (NEW category flags)
- **Danger:** 0 72% 51% (delete actions)

### Semantic Colors
- **AI Processing:** 270 70% 60% (purple for AI-generated content)
- **Quote Highlight:** 48 96% 89% with 15% opacity (soft yellow for customer quotes)
- **Category Badge:** Primary color at 20% opacity backgrounds

---

## Typography

**Font Stack:** Inter (Google Fonts) for entire application

### Hierarchy
- **Page Titles:** 600 weight, 1.875rem (30px)
- **Section Headers:** 600 weight, 1.5rem (24px)
- **Card Titles:** 500 weight, 1.125rem (18px)
- **Body Text:** 400 weight, 0.875rem (14px)
- **Table Headers:** 500 weight, 0.75rem (12px), uppercase, letter-spacing 0.05em
- **Captions/Meta:** 400 weight, 0.75rem (12px)
- **Monospace (transcripts):** 'JetBrains Mono' 400 weight, 0.875rem

### Text Colors
- Headers use Text Primary
- Body uses Text Secondary
- Meta information uses Text Muted
- All customer quotes use Text Primary with quote highlight background

---

## Layout System

**Spacing Units:** Tailwind scale using 2, 3, 4, 6, 8, 12, 16, 20, 24

### Container Structure
- **Max Width:** max-w-7xl (1280px) for main content
- **Page Padding:** px-6 md:px-8 lg:px-12
- **Section Spacing:** py-8 between major sections
- **Card Padding:** p-6 for standard cards
- **Table Cell Padding:** px-4 py-3

### Grid Patterns
- **Three-tab layout:** Horizontal tab bar (not vertical sidebar)
- **Input form:** Single column, max-w-3xl centered
- **Tables:** Full width within container, responsive horizontal scroll on mobile
- **Category management:** Two-column grid for category cards (grid-cols-1 lg:grid-cols-2)

---

## Component Library

### Navigation
- **Tab Bar:** Horizontal, sticky top, glass morphism effect (backdrop-blur-lg), border-b
- **Tab Items:** px-6 py-4, hover state with primary color underline, active tab with solid underline
- **Active Indicator:** 2px solid line in primary color

### Forms
- **Input Fields:** Surface elevated background, border on focus (primary color), rounded-lg, p-3
- **Text Areas:** Min-height 200px for transcript input, monospace font
- **Labels:** Text secondary, font-medium, mb-2
- **Helper Text:** Text muted, text-sm, mt-1
- **Field Groups:** Space-y-6 between field groups
- **Submit Button:** Primary color, rounded-lg, px-6 py-3, font-medium, with loading spinner state

### Tables
- **Table Container:** Surface elevated background, rounded-lg, overflow-hidden
- **Header Row:** Surface background, border-b-2, sticky top
- **Data Rows:** Border-b, hover state with surface color change
- **Cell Alignment:** Left for text, badges; right for actions
- **Quote Cells:** Italic text, quote highlight background, border-l-2 in AI processing color
- **Empty State:** Centered, text-muted, with illustration placeholder

### Cards & Badges
- **Insight Cards:** Surface elevated, rounded-lg, p-6, border-l-4 in primary color
- **Category Badges:** Rounded-full, px-3 py-1, text-xs, font-medium
  - Matched: Success color background at 20% opacity, success text
  - NEW: Warning color background at 20% opacity, warning text
- **Company Tag:** Surface background, rounded-md, px-2 py-1, text-xs

### Buttons
- **Primary:** Primary color background, text-white, hover darken 10%
- **Secondary:** Surface elevated, text-primary, hover surface color
- **Danger:** Danger color, text-white, used for delete actions
- **Icon Buttons:** p-2, rounded-md, hover surface elevated

### Modals & Overlays
- **Modal Backdrop:** Black with 50% opacity, backdrop-blur-sm
- **Modal Container:** Surface elevated, rounded-xl, max-w-2xl, p-8
- **Modal Header:** pb-4, border-b, flex justify-between items-center

### Data Visualization
- **Feature Context Display:** Two-column layout (feature name + context) with direct quote below in highlighted section
- **Q&A Pairs:** Three-column table (Question | Answer | Asker)
- **Category Pills:** Inline-flex with icon prefix (using Heroicons)
- **AI Badge:** Small purple badge with sparkle icon next to AI-generated content

### Icons
**Library:** Heroicons (outline for navigation, solid for status indicators)
- Document icon for transcripts
- Tag icon for categories
- Sparkles icon for AI processing
- Plus icon for add actions
- Pencil icon for edit
- Trash icon for delete

---

## Interaction Patterns

### Loading States
- **AI Processing:** Pulsing purple glow animation on transcript card during analysis
- **Skeleton Loaders:** For table rows while loading data
- **Inline Spinners:** Small spinners next to "Analyzing..." text

### Animations
**Minimal, functional only:**
- Tab transitions: 150ms ease-in-out
- Hover states: 100ms ease-out
- Modal fade-in: 200ms ease-out
- No scroll-triggered or decorative animations

### Feedback
- **Toast Notifications:** Top-right, auto-dismiss after 4s, success/error colors
- **Inline Validation:** Real-time for required fields, error text below inputs
- **Confirmation Dialogs:** For delete actions on transcripts/categories

---

## Page-Specific Layouts

### Tab 1: Add Transcript
- Centered form (max-w-3xl)
- Prominent "Add New Transcript" button at top-right
- Form fields in order: Company Name → Transcript Text → Leverege Team Members → Customer Names
- "Analyze Transcript" submit button at bottom, full-width on mobile

### Tab 2: Product Insights (Table 1)
- Filter bar at top (search, category dropdown)
- Table columns: Feature | Context | Customer Quote | Company | Category
- Expandable rows for long context/quotes
- Bulk category assignment action

### Tab 3: Q&A Database (Table 2)
- Search bar for questions/answers
- Table columns: Question | Answer | Asker | Company
- Sortable by company, asker

### Tab 4: Manage Categories
- "Add Category" button top-right
- Grid of category cards with edit/delete actions
- Each card shows category name and usage count
- Drag-to-reorder (visual indicator with grip icon)

---

## Responsive Behavior

- **Desktop (>1024px):** Full table layouts, two-column category grid
- **Tablet (768-1024px):** Horizontal scroll for tables, single-column categories
- **Mobile (<768px):** Card-based view for tables (stacked data), full-width inputs

All forms remain single-column across breakpoints for optimal completion flow.