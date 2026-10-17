import { NAV_GROUPS, NAV_ITEMS } from "@sting/app-core";
import { mtx } from "@sting/texts";
import { GroupedList, ListRow, Screen } from "@sting/ui-native";

import { openOnWeb } from "@/lib/web";

/**
 * «المزيد»: كل بنود تنقّل الويب بمجموعاتها نفسها (من `@sting/app-core`) — لا شاشة في الويب تغيب عن
 * الجوال. ما لم يُبنَ بعد يفتح على الويب.
 */
export default function More() {
  const groups = Object.values(NAV_GROUPS);
  return (
    <Screen screenId="MOB-MORE" state="ready" title={mtx("more")}>
      {groups.map((g) => {
        const items = NAV_ITEMS.filter((i) => i.group === g);
        return (
          <GroupedList key={g} title={g}>
            {items.map((i, n) => (
              <ListRow
                key={i.id}
                title={i.label}
                last={n === items.length - 1}
                onPress={() => void openOnWeb(i.href)}
              />
            ))}
          </GroupedList>
        );
      })}
    </Screen>
  );
}
