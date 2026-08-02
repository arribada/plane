/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

//ui
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckIcon, ChevronDownIcon, Eraser, MoveRight } from "lucide-react";
// constants
import { SPREADSHEET_PROPERTY_DETAILS } from "@plane/constants";
// i18n
import { useTranslation } from "@plane/i18n";
// types
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties, TIssueOrderByOptions } from "@plane/types";
import { CustomMenu, Row } from "@plane/ui";
import { SpreadSheetPropertyIcon } from "../../utils";

interface Props {
  property: keyof IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  onClose: () => void;
  isEpic?: boolean;
}

export function HeaderColumn(props: Props) {
  const { displayFilters, handleDisplayFilterUpdate, property, onClose, isEpic = false } = props;
  // i18n
  const { t } = useTranslation();
  const propertyDetails = SPREADSHEET_PROPERTY_DETAILS[property];

  /**
   * Which way this column is sorted, read from the filter that actually sorts it.
   *
   * This used to come from two unscoped localStorage keys written only by the
   * menu handler below. useLocalStorage does no key scoping, so one string was
   * shared by every project, view and layout in the browser: sort project A by
   * due date, open project B, and B's due-date column drew a confident ascending
   * arrow whatever B was really sorted by. And order_by can also be set from
   * Display > Order by and is persisted on shared saved views — so a colleague
   * opening someone else's sorted view saw no arrow at all and read the sheet as
   * unsorted. The truth was in `displayFilters` the whole time.
   */
  const sortedAscending = propertyDetails && displayFilters.order_by === propertyDetails.ascendingOrderKey;
  const sortedDescending = propertyDetails && displayFilters.order_by === propertyDetails.descendingOrderKey;
  const isSortedByThisColumn = sortedAscending || sortedDescending;

  const handleOrderBy = (order: TIssueOrderByOptions) => {
    handleDisplayFilterUpdate({ order_by: order });
  };

  if (!propertyDetails) return null;

  return (
    <CustomMenu
      customButtonClassName="clickable !w-full"
      customButtonTabIndex={-1}
      className="!w-full"
      customButton={
        <Row className="flex w-full cursor-pointer items-center justify-between gap-1.5 py-2 text-13 text-secondary hover:text-primary">
          <div className="flex items-center gap-1.5">
            {<SpreadSheetPropertyIcon iconKey={propertyDetails.icon} className="h-4 w-4 text-placeholder" />}
            {property === "sub_issue_count" && isEpic ? t("issue.label", { count: 2 }) : t(propertyDetails.i18n_title)}
          </div>
          <div className="ml-3 flex">
            {isSortedByThisColumn && (
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full">
                {sortedAscending ? (
                  <ArrowDownWideNarrow className="h-3 w-3" />
                ) : (
                  <ArrowUpNarrowWide className="h-3 w-3" />
                )}
              </div>
            )}
            <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
          </div>
        </Row>
      }
      onMenuClose={onClose}
      placement="bottom-start"
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={() => handleOrderBy(propertyDetails.ascendingOrderKey)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            sortedAscending ? "text-primary" : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowDownWideNarrow className="h-3 w-3 stroke-[1.5]" />
            <span>{propertyDetails.ascendingOrderTitle}</span>
            <MoveRight className="h-3 w-3" />
            <span>{propertyDetails.descendingOrderTitle}</span>
          </div>

          {sortedAscending && <CheckIcon className="h-3 w-3" />}
        </div>
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => handleOrderBy(propertyDetails.descendingOrderKey)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            sortedDescending ? "text-primary" : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowUpNarrowWide className="h-3 w-3 stroke-[1.5]" />
            <span>{propertyDetails.descendingOrderTitle}</span>
            <MoveRight className="h-3 w-3" />
            <span>{propertyDetails.ascendingOrderTitle}</span>
          </div>

          {sortedDescending && <CheckIcon className="h-3 w-3" />}
        </div>
      </CustomMenu.MenuItem>
      {/* Offered only where it would do something: this column is the sort key, and
          the sort is not already the default. */}
      {isSortedByThisColumn && displayFilters?.order_by !== "-created_at" && (
        <CustomMenu.MenuItem className="mt-0.5" key={property} onClick={() => handleOrderBy("-created_at")}>
          <div className="flex items-center gap-2 px-1">
            <Eraser className="h-3 w-3" />
            <span>{t("common.actions.clear_sorting")}</span>
          </div>
        </CustomMenu.MenuItem>
      )}
    </CustomMenu>
  );
}
