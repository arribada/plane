/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Arribada work-item properties chosen WHILE creating, before the item exists.
 *
 * Discipline and effort are separate models keyed on a work item id, so they can
 * only be written once the item has been created. The create modal collects them
 * into this context; IssueModalProvider then applies them in the "add other
 * property values" step the core modal already runs after create — so a person
 * can set discipline and effort at creation instead of creating, then reopening.
 *
 * A modal that is closed unmounts the provider, so every open starts with these
 * unset — an untouched field applies nothing and ordinary creation is untouched.
 */
import { createContext, useContext } from "react";

export type TArribadaCreateProps = {
  /** The discipline (IssueRole) to set, or null for none. */
  discipline: string | null;
  setDiscipline: (value: string | null) => void;
  /** Planned effort in person-days (IssueEffort), or null to leave unset. */
  effortDays: number | null;
  setEffortDays: (value: number | null) => void;
};

export const ArribadaCreateContext = createContext<TArribadaCreateProps | null>(null);

export const useArribadaCreate = () => useContext(ArribadaCreateContext);
