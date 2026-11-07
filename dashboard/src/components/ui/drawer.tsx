import { Icon } from '../Icon'
import type { ComponentProps, ReactNode } from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { cn } from "cn"

function Drawer(props: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({ children }: { children?: ReactNode }) {
  return (
    <DrawerPrimitive.Portal data-slot="drawer-portal">
      <DrawerPrimitive.Backdrop
        data-slot="drawer-backdrop"
        className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 data-starting-style:opacity-0 data-ending-style:opacity-0"
      />
      <DrawerPrimitive.Popup
        data-slot="drawer-popup"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-xl border-t border-[var(--line)] bg-[var(--surface)] text-[var(--fg)] shadow-lg transition-transform duration-300 data-starting-style:translate-y-full data-ending-style:translate-y-full"
      >
        {children}
      </DrawerPrimitive.Popup>
    </DrawerPrimitive.Portal>
  )
}

function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex shrink-0 items-center justify-between border-b border-[var(--line)] px-4 py-3", className)}
      {...props}
    />
  )
}

function DrawerTitle(props: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className="text-sm font-semibold text-[var(--fg)]"
      {...props}
    />
  )
}

function DrawerClose({ className, children, ...props }: DrawerPrimitive.Close.Props) {
  return (
    <DrawerPrimitive.Close
      data-slot="drawer-close"
      className={cn("rounded-md p-1 text-[var(--muted-text)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]", className)}
      {...props}
    >
      {children ?? <Icon name="close-outline" style={{ fontSize: 18 }} />}
    </DrawerPrimitive.Close>
  )
}

function DrawerBody({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="drawer-body" className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3", className)} {...props} />
}

function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("flex shrink-0 items-center gap-2 border-t border-[var(--line)] px-4 py-3", className)}
      {...props}
    />
  )
}

export { Drawer, DrawerTrigger, DrawerPortal, DrawerHeader, DrawerTitle, DrawerClose, DrawerBody, DrawerFooter }
