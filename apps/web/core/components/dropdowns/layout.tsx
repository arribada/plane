/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import { ISSUE_LAYOUT_MAP } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { CheckIcon } from "@plane/propel/icons";
import { EIssueLayoutTypes } from "@plane/types";
import { Dropdown } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { IssueLayoutIcon } from "@/components/issues/issue-layouts/layout-icon";
import { getButtonStyling } from "@plane/propel/button";

type TLayoutDropDown = {
  onChange: (value: EIssueLayoutTypes) => void;
  value: EIssueLayoutTypes;
  disabledLayouts?: EIssueLayoutTypes[];
};

export const LayoutDropDown = observer(function LayoutDropDown(props: TLayoutDropDown) {
  const { onChange, value = EIssueLayoutTypes.LIST, disabledLayouts = [] } = props;
  // plane i18n
  const { t } = useTranslation();
  // derived values
  const availableLayouts = useMemo(
    () => Object.values(ISSUE_LAYOUT_MAP).filter((layout) => !disabledLayouts.includes(layout.key)),
    [disabledLayouts]
  );

  const options = useMemo(
    () =>
      availableLayouts.map((issueLayout) => ({
        data: issueLayout.key,
        value: issueLayout.key,
      })),
    [availableLayouts]
  );

  const buttonContent = useCallback(
    (isOpen: boolean, buttonValue: string | string[] | undefined) => {
      const dropdownValue = ISSUE_LAYOUT_MAP[buttonValue as EIssueLayoutTypes];
      return (
        <div className="flex items-center gap-2 text-secondary">
          <IssueLayoutIcon layout={dropdownValue.key} strokeWidth={2} className={`size-3.5 text-secondary`} />
          <span className="text-11 font-medium">{t(dropdownValue.i18n_label)}</span>
        </div>
      );
    },
    [t]
  );

  const itemContent = useCallback(
    (item: { value: string; selected: boolean }) => {
      const dropdownValue = ISSUE_LAYOUT_MAP[item.value as EIssueLayoutTypes];

      return (
        <div className={cn("flex w-full items-center justify-between gap-2 text-secondary")}>
          <div className="flex items-center gap-2">
            <IssueLayoutIcon layout={dropdownValue.key} strokeWidth={2} className={`size-3 text-secondary`} />
            <span className="text-11 font-medium">{t(dropdownValue.i18n_label)}</span>
          </div>
          {item.selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
        </div>
      );
    },
    [t]
  );

  const keyExtractor = useCallback((option: any) => option.value, []);

  return (
    <Dropdown
      onChange={onChange as (value: string) => void}
      value={value?.toString()}
      keyExtractor={keyExtractor}
      options={options}
      // A normal button, not an icon button. The icon-button variants carry
      // `aspect-square` plus a `size-*` that fixes WIDTH as well as height, so a
      // trigger holding an icon AND a label ("List") was laid out as a 28px
      // square and spilled its content outside the box. The `w-auto px-2` bolted
      // on here could not reliably win: it collides with `size-7` in the same
      // tailwind-merge group, so the result depended on class order rather than
      // on intent. This is the styling the "Display" trigger beside it uses.
      buttonContainerClassName={cn(getButtonStyling("secondary", "lg"), "w-auto")}
      buttonContent={buttonContent}
      renderItem={itemContent}
      disableSearch
    />
  );
});
