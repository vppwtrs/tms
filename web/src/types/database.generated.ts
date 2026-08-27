export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      customer_interactions: {
        Row: {
          created_at: string
          created_by: number | null
          customer_id: number
          happened_at: string
          id: number
          note: string | null
          subject: string
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Insert: {
          created_at?: string
          created_by?: number | null
          customer_id: number
          happened_at: string
          id?: never
          note?: string | null
          subject: string
          type?: Database["public"]["Enums"]["interaction_type"]
        }
        Update: {
          created_at?: string
          created_by?: number | null
          customer_id?: number
          happened_at?: string
          id?: never
          note?: string | null
          subject?: string
          type?: Database["public"]["Enums"]["interaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "customer_interactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_interactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tasks: {
        Row: {
          created_at: string
          created_by: number | null
          customer_id: number
          due_at: string | null
          id: number
          note: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: number | null
          customer_id: number
          due_at?: string | null
          id?: never
          note?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Update: {
          created_at?: string
          created_by?: number | null
          customer_id?: number
          due_at?: string | null
          id?: never
          note?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          credit_terms: number | null
          email: string | null
          id: number
          name: string
          phone: string | null
          price_note: string | null
          segment: string
          tags: string | null
          tax_id: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          credit_terms?: number | null
          email?: string | null
          id?: never
          name: string
          phone?: string | null
          price_note?: string | null
          segment?: string
          tags?: string | null
          tax_id?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          credit_terms?: number | null
          email?: string | null
          id?: never
          name?: string
          phone?: string | null
          price_note?: string | null
          segment?: string
          tags?: string | null
          tax_id?: string | null
        }
        Relationships: []
      }
      drivers: {
        Row: {
          created_at: string
          id: number
          joined_at: string | null
          license_no: string | null
          license_type: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["driver_status"]
          user_id: number | null
        }
        Insert: {
          created_at?: string
          id?: never
          joined_at?: string | null
          license_no?: string | null
          license_type?: string | null
          name: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          user_id?: number | null
        }
        Update: {
          created_at?: string
          id?: never
          joined_at?: string | null
          license_no?: string | null
          license_type?: string | null
          name?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_audit_log: {
        Row: {
          action: string
          actor_user_id: number | null
          created_at: string
          detail: Json | null
          id: number
          order_id: number | null
          pod_id: number | null
          trip_no: string | null
        }
        Insert: {
          action: string
          actor_user_id?: number | null
          created_at?: string
          detail?: Json | null
          id?: number
          order_id?: number | null
          pod_id?: number | null
          trip_no?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: number | null
          created_at?: string
          detail?: Json | null
          id?: number
          order_id?: number | null
          pod_id?: number | null
          trip_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: number
          item_name: string | null
          item_no: string
          order_id: number
          qty: number
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          item_name?: string | null
          item_no: string
          order_id: number
          qty?: number
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          item_name?: string | null
          item_no?: string
          order_id?: number
          qty?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "my_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: number | null
          created_at: string
          customer_id: number | null
          delivered_at: string | null
          destination: string
          distance_km: number
          fee: number
          goods_desc: string
          id: number
          notes: string | null
          order_no: string
          origin: string
          priority: Database["public"]["Enums"]["order_priority"]
          scheduled_at: string
          seq: number | null
          status: Database["public"]["Enums"]["order_status"]
          tms_picking_list_no: string | null
          tms_trip_no: string | null
          tms_unit_count: number | null
          trip_id: number | null
          updated_at: string
          weight_kg: number
          work_kind: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: number | null
          created_at?: string
          customer_id?: number | null
          delivered_at?: string | null
          destination: string
          distance_km?: number
          fee?: number
          goods_desc: string
          id?: never
          notes?: string | null
          order_no: string
          origin: string
          priority?: Database["public"]["Enums"]["order_priority"]
          scheduled_at: string
          seq?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          tms_picking_list_no?: string | null
          tms_trip_no?: string | null
          tms_unit_count?: number | null
          trip_id?: number | null
          updated_at?: string
          weight_kg?: number
          work_kind?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: number | null
          created_at?: string
          customer_id?: number | null
          delivered_at?: string | null
          destination?: string
          distance_km?: number
          fee?: number
          goods_desc?: string
          id?: never
          notes?: string | null
          order_no?: string
          origin?: string
          priority?: Database["public"]["Enums"]["order_priority"]
          scheduled_at?: string
          seq?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          tms_picking_list_no?: string | null
          tms_trip_no?: string | null
          tms_unit_count?: number | null
          trip_id?: number | null
          updated_at?: string
          weight_kg?: number
          work_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "my_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_audit_log: {
        Row: {
          action: string
          actor_user_id: number | null
          after_value: string | null
          before_value: string | null
          created_at: string
          id: number
          permission: string | null
          reason: string | null
          role: string | null
          target_user_id: number | null
        }
        Insert: {
          action: string
          actor_user_id?: number | null
          after_value?: string | null
          before_value?: string | null
          created_at?: string
          id?: number
          permission?: string | null
          reason?: string | null
          role?: string | null
          target_user_id?: number | null
        }
        Update: {
          action?: string
          actor_user_id?: number | null
          after_value?: string | null
          before_value?: string | null
          created_at?: string
          id?: number
          permission?: string | null
          reason?: string | null
          role?: string | null
          target_user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          label: string
          permission: string
        }
        Insert: {
          label: string
          permission: string
        }
        Update: {
          label?: string
          permission?: string
        }
        Relationships: []
      }
      pod: {
        Row: {
          collected_at: string
          collected_by: number
          id: number
          lat: number | null
          lng: number | null
          notes: string | null
          order_id: number
          photo_path: string | null
          recipient_name: string
          signature_data: string
          status: Database["public"]["Enums"]["pod_status"]
          updated_at: string
        }
        Insert: {
          collected_at: string
          collected_by: number
          id?: never
          lat?: number | null
          lng?: number | null
          notes?: string | null
          order_id: number
          photo_path?: string | null
          recipient_name: string
          signature_data: string
          status?: Database["public"]["Enums"]["pod_status"]
          updated_at?: string
        }
        Update: {
          collected_at?: string
          collected_by?: number
          id?: never
          lat?: number | null
          lng?: number | null
          notes?: string | null
          order_id?: number
          photo_path?: string | null
          recipient_name?: string
          signature_data?: string
          status?: Database["public"]["Enums"]["pod_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pod_collected_by_fkey"
            columns: ["collected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pod_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "my_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pod_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pod_photos: {
        Row: {
          created_at: string
          id: number
          kind: string
          path: string
          pod_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          kind?: string
          path: string
          pod_id: number
        }
        Update: {
          created_at?: string
          id?: number
          kind?: string
          path?: string
          pod_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "pod_photos_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pod"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          converted_order_id: number | null
          created_at: string
          created_by: number | null
          customer_id: number | null
          destination: string
          distance_km: number
          fee: number
          goods_desc: string
          id: number
          notes: string | null
          origin: string
          quote_no: string
          status: Database["public"]["Enums"]["quote_status"]
          updated_at: string
          valid_until: string | null
          weight_kg: number
        }
        Insert: {
          converted_order_id?: number | null
          created_at?: string
          created_by?: number | null
          customer_id?: number | null
          destination: string
          distance_km?: number
          fee?: number
          goods_desc: string
          id?: never
          notes?: string | null
          origin: string
          quote_no: string
          status?: Database["public"]["Enums"]["quote_status"]
          updated_at?: string
          valid_until?: string | null
          weight_kg?: number
        }
        Update: {
          converted_order_id?: number | null
          created_at?: string
          created_by?: number | null
          customer_id?: number | null
          destination?: string
          distance_km?: number
          fee?: number
          goods_desc?: string
          id?: never
          notes?: string | null
          origin?: string
          quote_no?: string
          status?: Database["public"]["Enums"]["quote_status"]
          updated_at?: string
          valid_until?: string | null
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotes_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "my_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          permission: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          permission?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["permission"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      tms_carriers: {
        Row: {
          carrier_name: string
          is_ours: boolean
          note: string | null
        }
        Insert: {
          carrier_name: string
          is_ours?: boolean
          note?: string | null
        }
        Update: {
          carrier_name?: string
          is_ours?: boolean
          note?: string | null
        }
        Relationships: []
      }
      tms_dealer_map: {
        Row: {
          created_at: string
          customer_id: number | null
          dealer_code: string
          dealer_name: string
          ignored: boolean
          mapped_at: string | null
          mapped_by: number | null
        }
        Insert: {
          created_at?: string
          customer_id?: number | null
          dealer_code: string
          dealer_name: string
          ignored?: boolean
          mapped_at?: string | null
          mapped_by?: number | null
        }
        Update: {
          created_at?: string
          customer_id?: number | null
          dealer_code?: string
          dealer_name?: string
          ignored?: boolean
          mapped_at?: string | null
          mapped_by?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tms_dealer_map_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tms_dealer_map_mapped_by_fkey"
            columns: ["mapped_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tms_driver_map: {
        Row: {
          created_at: string
          driver_id: number | null
          driver_key: string
          ignored: boolean
          mapped_at: string | null
          mapped_by: number | null
        }
        Insert: {
          created_at?: string
          driver_id?: number | null
          driver_key: string
          ignored?: boolean
          mapped_at?: string | null
          mapped_by?: number | null
        }
        Update: {
          created_at?: string
          driver_id?: number | null
          driver_key?: string
          ignored?: boolean
          mapped_at?: string | null
          mapped_by?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tms_driver_map_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tms_driver_map_mapped_by_fkey"
            columns: ["mapped_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tms_login_attempts: {
        Row: {
          key: string
          tries: number
          window_start: string
        }
        Insert: {
          key: string
          tries?: number
          window_start?: string
        }
        Update: {
          key?: string
          tries?: number
          window_start?: string
        }
        Relationships: []
      }
      tms_pull_runs: {
        Row: {
          date_from: string
          date_to: string
          error: string | null
          id: number
          mode: string
          ok: boolean
          ran_at: string
          ran_by: number | null
          ran_by_name: string | null
          rows_changed: number
          trips_ours: number
          trips_seen: number
          warehouses: string[]
        }
        Insert: {
          date_from: string
          date_to: string
          error?: string | null
          id?: number
          mode: string
          ok?: boolean
          ran_at?: string
          ran_by?: number | null
          ran_by_name?: string | null
          rows_changed?: number
          trips_ours?: number
          trips_seen?: number
          warehouses?: string[]
        }
        Update: {
          date_from?: string
          date_to?: string
          error?: string | null
          id?: number
          mode?: string
          ok?: boolean
          ran_at?: string
          ran_by?: number | null
          ran_by_name?: string | null
          rows_changed?: number
          trips_ours?: number
          trips_seen?: number
          warehouses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "tms_pull_runs_ran_by_fkey"
            columns: ["ran_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tms_sessions: {
        Row: {
          auth_id: string
          expires_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          auth_id: string
          expires_at?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          auth_id?: string
          expires_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      tms_shipments: {
        Row: {
          actual_cost: number | null
          area: string | null
          branch: string | null
          customer_address: string | null
          dealer_code: string | null
          dealer_name: string | null
          delivery_date: string | null
          driver_name: string | null
          first_seen_at: string
          id: number
          item_name: string | null
          item_no: string | null
          item_qty: number | null
          item_split_qty: number | null
          license_plate: string | null
          order_id: number | null
          picking_list_no: string
          pickup_date: string | null
          pl_status: string | null
          pl_type: string | null
          plan_delivery_date: string | null
          province: string | null
          qty_source: string | null
          raw: Json
          row_hash: string | null
          ship_to_address: string | null
          ship_to_name: string | null
          ship_to_postcode: string | null
          ship_to_province: string | null
          status_changed_at: string | null
          status_delivery: string | null
          synced_at: string
          tms_trip_id: string | null
          total_qty: number | null
          trip_date: string | null
          trip_no_tms: string | null
          trip_status: string | null
          unit: number | null
        }
        Insert: {
          actual_cost?: number | null
          area?: string | null
          branch?: string | null
          customer_address?: string | null
          dealer_code?: string | null
          dealer_name?: string | null
          delivery_date?: string | null
          driver_name?: string | null
          first_seen_at?: string
          id?: never
          item_name?: string | null
          item_no?: string | null
          item_qty?: number | null
          item_split_qty?: number | null
          license_plate?: string | null
          order_id?: number | null
          picking_list_no: string
          pickup_date?: string | null
          pl_status?: string | null
          pl_type?: string | null
          plan_delivery_date?: string | null
          province?: string | null
          qty_source?: string | null
          raw: Json
          row_hash?: string | null
          ship_to_address?: string | null
          ship_to_name?: string | null
          ship_to_postcode?: string | null
          ship_to_province?: string | null
          status_changed_at?: string | null
          status_delivery?: string | null
          synced_at?: string
          tms_trip_id?: string | null
          total_qty?: number | null
          trip_date?: string | null
          trip_no_tms?: string | null
          trip_status?: string | null
          unit?: number | null
        }
        Update: {
          actual_cost?: number | null
          area?: string | null
          branch?: string | null
          customer_address?: string | null
          dealer_code?: string | null
          dealer_name?: string | null
          delivery_date?: string | null
          driver_name?: string | null
          first_seen_at?: string
          id?: never
          item_name?: string | null
          item_no?: string | null
          item_qty?: number | null
          item_split_qty?: number | null
          license_plate?: string | null
          order_id?: number | null
          picking_list_no?: string
          pickup_date?: string | null
          pl_status?: string | null
          pl_type?: string | null
          plan_delivery_date?: string | null
          province?: string | null
          qty_source?: string | null
          raw?: Json
          row_hash?: string | null
          ship_to_address?: string | null
          ship_to_name?: string | null
          ship_to_postcode?: string | null
          ship_to_province?: string | null
          status_changed_at?: string | null
          status_delivery?: string | null
          synced_at?: string
          tms_trip_id?: string | null
          total_qty?: number | null
          trip_date?: string | null
          trip_no_tms?: string | null
          trip_status?: string | null
          unit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tms_shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "my_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tms_shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tms_shipments_tms_trip_id_fkey"
            columns: ["tms_trip_id"]
            isOneToOne: false
            referencedRelation: "tms_trips"
            referencedColumns: ["tms_id"]
          },
        ]
      }
      tms_sync_log: {
        Row: {
          id: number
          picking_lists: number
          rows_inserted: number
          rows_pushed: number
          rows_updated: number
          source: string
          synced_at: string
          synced_by: number | null
          trip_date: string
        }
        Insert: {
          id?: never
          picking_lists?: number
          rows_inserted?: number
          rows_pushed?: number
          rows_updated?: number
          source?: string
          synced_at?: string
          synced_by?: number | null
          trip_date: string
        }
        Update: {
          id?: never
          picking_lists?: number
          rows_inserted?: number
          rows_pushed?: number
          rows_updated?: number
          source?: string
          synced_at?: string
          synced_by?: number | null
          trip_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "tms_sync_log_synced_by_fkey"
            columns: ["synced_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tms_trips: {
        Row: {
          actual_cost: number | null
          area: string | null
          carrier_id: string | null
          carrier_name: string | null
          cost: number | null
          driver_name: string | null
          first_seen_at: string
          license_plate: string | null
          on_delivery_date: string | null
          order_date: string | null
          raw: Json
          reason: string | null
          row_hash: string | null
          status: string | null
          status_changed_at: string | null
          status_id: number | null
          synced_at: string
          tms_id: string
          total_pl: number | null
          total_unit: number | null
          trip_id: number | null
          trip_no: string
          vehicle_type: string | null
          warehouse_code: string | null
          warehouse_id: string | null
        }
        Insert: {
          actual_cost?: number | null
          area?: string | null
          carrier_id?: string | null
          carrier_name?: string | null
          cost?: number | null
          driver_name?: string | null
          first_seen_at?: string
          license_plate?: string | null
          on_delivery_date?: string | null
          order_date?: string | null
          raw: Json
          reason?: string | null
          row_hash?: string | null
          status?: string | null
          status_changed_at?: string | null
          status_id?: number | null
          synced_at?: string
          tms_id: string
          total_pl?: number | null
          total_unit?: number | null
          trip_id?: number | null
          trip_no: string
          vehicle_type?: string | null
          warehouse_code?: string | null
          warehouse_id?: string | null
        }
        Update: {
          actual_cost?: number | null
          area?: string | null
          carrier_id?: string | null
          carrier_name?: string | null
          cost?: number | null
          driver_name?: string | null
          first_seen_at?: string
          license_plate?: string | null
          on_delivery_date?: string | null
          order_date?: string | null
          raw?: Json
          reason?: string | null
          row_hash?: string | null
          status?: string | null
          status_changed_at?: string | null
          status_id?: number | null
          synced_at?: string
          tms_id?: string
          total_pl?: number | null
          total_unit?: number | null
          trip_id?: number | null
          trip_no?: string
          vehicle_type?: string | null
          warehouse_code?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tms_trips_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "my_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tms_trips_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      tms_vehicle_map: {
        Row: {
          created_at: string
          ignored: boolean
          mapped_at: string | null
          mapped_by: number | null
          plate: string
          vehicle_id: number | null
        }
        Insert: {
          created_at?: string
          ignored?: boolean
          mapped_at?: string | null
          mapped_by?: number | null
          plate: string
          vehicle_id?: number | null
        }
        Update: {
          created_at?: string
          ignored?: boolean
          mapped_at?: string | null
          mapped_by?: number | null
          plate?: string
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tms_vehicle_map_mapped_by_fkey"
            columns: ["mapped_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tms_vehicle_map_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_drivers: {
        Row: {
          accepted_at: string | null
          created_at: string
          driver_id: number
          seq: number
          trip_id: number
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          driver_id: number
          seq?: number
          trip_id: number
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          driver_id?: number
          seq?: number
          trip_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_drivers_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_drivers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "my_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_drivers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_locations: {
        Row: {
          accuracy_m: number | null
          driver_id: number | null
          id: number
          lat: number
          lng: number
          recorded_at: string
          trip_id: number
        }
        Insert: {
          accuracy_m?: number | null
          driver_id?: number | null
          id?: number
          lat: number
          lng: number
          recorded_at?: string
          trip_id: number
        }
        Update: {
          accuracy_m?: number | null
          driver_id?: number | null
          id?: number
          lat?: number
          lng?: number
          recorded_at?: string
          trip_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "my_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          accepted_at: string | null
          accepted_by: number | null
          arrived_at: string | null
          closed_by: number | null
          created_at: string
          departed_at: string | null
          driver_id: number
          freight_actual_cost: number | null
          freight_cost: number | null
          fuel_cost: number
          id: number
          issue_at: string | null
          issue_note: string | null
          notes: string | null
          other_cost: number
          returned_at: string | null
          status: Database["public"]["Enums"]["trip_status"]
          toll_cost: number
          toll_reported_at: string | null
          toll_reported_by: number | null
          trip_no: string
          vehicle_id: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: number | null
          arrived_at?: string | null
          closed_by?: number | null
          created_at?: string
          departed_at?: string | null
          driver_id: number
          freight_actual_cost?: number | null
          freight_cost?: number | null
          fuel_cost?: number
          id?: never
          issue_at?: string | null
          issue_note?: string | null
          notes?: string | null
          other_cost?: number
          returned_at?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          toll_cost?: number
          toll_reported_at?: string | null
          toll_reported_by?: number | null
          trip_no: string
          vehicle_id: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: number | null
          arrived_at?: string | null
          closed_by?: number | null
          created_at?: string
          departed_at?: string | null
          driver_id?: number
          freight_actual_cost?: number | null
          freight_cost?: number | null
          fuel_cost?: number
          id?: never
          issue_at?: string | null
          issue_note?: string | null
          notes?: string | null
          other_cost?: number
          returned_at?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          toll_cost?: number
          toll_reported_at?: string | null
          toll_reported_by?: number | null
          trip_no?: string
          vehicle_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "trips_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_toll_reported_by_fkey"
            columns: ["toll_reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          allowed: boolean
          mode: string | null
          permission: string
          user_id: number
        }
        Insert: {
          allowed: boolean
          mode?: string | null
          permission: string
          user_id: number
        }
        Update: {
          allowed?: boolean
          mode?: string | null
          permission?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          approved_at: string | null
          approved_by: number | null
          auth_id: string | null
          auth_source: string
          created_at: string
          id: number
          is_active: boolean
          last_login_at: string | null
          must_change_password: boolean
          name: string
          role: Database["public"]["Enums"]["user_role"]
          username: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: number | null
          auth_id?: string | null
          auth_source?: string
          created_at?: string
          id?: never
          is_active?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          username: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: number | null
          auth_id?: string | null
          auth_source?: string
          created_at?: string
          id?: never
          is_active?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_odometer: {
        Row: {
          created_at: string
          driver_id: number
          id: number
          kind: string
          reading_date: string
          reading_km: number
          taken_at: string
          trip_id: number | null
          vehicle_id: number
        }
        Insert: {
          created_at?: string
          driver_id: number
          id?: number
          kind?: string
          reading_date?: string
          reading_km: number
          taken_at?: string
          trip_id?: number | null
          vehicle_id: number
        }
        Update: {
          created_at?: string
          driver_id?: number
          id?: number
          kind?: string
          reading_date?: string
          reading_km?: number
          taken_at?: string
          trip_id?: number | null
          vehicle_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_odometer_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "my_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          brand: string | null
          capacity_kg: number
          created_at: string
          id: number
          model: string | null
          plate_no: string
          status: Database["public"]["Enums"]["vehicle_status"]
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Insert: {
          brand?: string | null
          capacity_kg?: number
          created_at?: string
          id?: never
          model?: string | null
          plate_no: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
        }
        Update: {
          brand?: string | null
          capacity_kg?: number
          created_at?: string
          id?: never
          model?: string | null
          plate_no?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
        }
        Relationships: []
      }
    }
    Views: {
      my_orders: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          customer_address: string | null
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          destination: string | null
          distance_km: number | null
          goods_desc: string | null
          has_pod: boolean | null
          id: number | null
          notes: string | null
          order_no: string | null
          origin: string | null
          priority: Database["public"]["Enums"]["order_priority"] | null
          scheduled_at: string | null
          seq: number | null
          status: Database["public"]["Enums"]["order_status"] | null
          tms_picking_list_no: string | null
          tms_trip_no: string | null
          tms_unit_count: number | null
          trip_id: number | null
          weight_kg: number | null
          work_kind: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "my_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      my_trips: {
        Row: {
          accepted_at: string | null
          accepted_count: number | null
          area: string | null
          arrived_at: string | null
          departed_at: string | null
          driver_count: number | null
          id: number | null
          is_primary: boolean | null
          issue_at: string | null
          issue_note: string | null
          my_accepted_at: string | null
          notes: string | null
          plate_no: string | null
          status: Database["public"]["Enums"]["trip_status"] | null
          trip_no: string | null
          vehicle_id: number | null
          vehicle_type: Database["public"]["Enums"]["vehicle_type"] | null
          warehouse_code: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_trip: { Args: { p_trip_id: number }; Returns: Json }
      add_orders_to_trip: {
        Args: { p_order_ids: number[]; p_trip_id: number }
        Returns: Json
      }
      admin_force_delete_trip: { Args: { p_trip_id: number }; Returns: Json }
      admin_reset_user_permissions: {
        Args: { p_reason?: string; p_user_id: number }
        Returns: undefined
      }
      admin_save_user_permission: {
        Args: {
          p_mode: string
          p_permission: string
          p_reason?: string
          p_user_id: number
        }
        Returns: undefined
      }
      admin_set_role_permission: {
        Args: {
          p_allowed: boolean
          p_permission: string
          p_reason?: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: undefined
      }
      approve_user: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_user_id: number
        }
        Returns: Json
      }
      attach_user_to_driver: {
        Args: { p_driver_id: number; p_user_id: number }
        Returns: Json
      }
      auto_import_trips: { Args: never; Returns: Json }
      cancel_stop: {
        Args: { p_order_ids: number[]; p_reason: string }
        Returns: Json
      }
      cleanup_tms_raw: { Args: { p_keep_days?: number }; Returns: Json }
      clear_my_password_flag: { Args: never; Returns: undefined }
      clear_trip_issue: { Args: { p_trip_id: number }; Returns: undefined }
      complete_trip: { Args: { p_trip_id: number }; Returns: undefined }
      convert_quote: {
        Args: { p_notes?: string; p_quote_id: number; p_scheduled_at: string }
        Returns: Json
      }
      create_app_user: {
        Args: {
          p_as_driver?: boolean
          p_auth_id: string
          p_name: string
          p_phone?: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_username: string
        }
        Returns: Json
      }
      create_customer_from_dealer: {
        Args: { p_dealer_code: string }
        Returns: Json
      }
      create_driver_from_tms: { Args: { p_driver_key: string }; Returns: Json }
      create_trip: {
        Args: {
          p_driver_id: number
          p_notes?: string
          p_order_ids: number[]
          p_vehicle_id: number
        }
        Returns: Json
      }
      create_vehicle_from_tms: { Args: { p_plate: string }; Returns: Json }
      delete_customer: { Args: { p_id: number }; Returns: Json }
      delete_driver: { Args: { p_id: number }; Returns: Json }
      delete_vehicle: { Args: { p_id: number }; Returns: Json }
      deliver_order: { Args: { p_order_id: number }; Returns: undefined }
      dispatch_cancel_trip: { Args: { p_trip_id: number }; Returns: Json }
      dispatch_complete_trip: { Args: { p_trip_id: number }; Returns: Json }
      dispatch_start_trip: { Args: { p_trip_id: number }; Returns: undefined }
      drivers_busy_on: {
        Args: { p_date: string; p_driver_ids: number[] }
        Returns: Json
      }
      drivers_without_account: { Args: never; Returns: Json }
      effective_permissions: {
        Args: { p_user_id: number }
        Returns: {
          allowed: boolean
          permission: string
          source: string
        }[]
      }
      finish_return: {
        Args: { p_toll_cost?: number; p_trip_id: number }
        Returns: Json
      }
      i_can: { Args: { p_permission: string }; Returns: boolean }
      import_tms_shipments: { Args: { p_date: string }; Returns: Json }
      import_tms_trip: {
        Args: { p_driver_ids?: number[]; p_tms_id: string }
        Returns: Json
      }
      link_tms_orders_to_customers: { Args: never; Returns: Json }
      log_odometer: {
        Args: { p_kind?: string; p_reading_km: number; p_vehicle_id: number }
        Returns: Json
      }
      log_tms_pull_run: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_error?: string
          p_mode: string
          p_ok?: boolean
          p_rows_changed?: number
          p_trips_ours?: number
          p_trips_seen?: number
          p_warehouses: string[]
        }
        Returns: number
      }
      log_trip_location: {
        Args: {
          p_accuracy_m?: number
          p_lat: number
          p_lng: number
          p_trip_id: number
        }
        Returns: undefined
      }
      merge_drivers: { Args: { p_drop: number; p_keep: number }; Returns: Json }
      my_account: { Args: never; Returns: Json }
      odometer_status: { Args: { p_vehicle_id: number }; Returns: Json }
      pod_of_order: { Args: { p_order_id: number }; Returns: Json }
      pod_photos_of_order: { Args: { p_order_id: number }; Returns: Json }
      preview_tms_import: { Args: { p_date: string }; Returns: Json }
      preview_tms_trips: { Args: { p_date?: string }; Returns: Json }
      push_tms_shipments: { Args: { p_rows: Json }; Returns: Json }
      push_tms_trips: { Args: { p_rows: Json }; Returns: Json }
      push_tms_trips_and_sync: { Args: { p_rows: Json }; Returns: Json }
      reconcile_tms_trips: {
        Args: {
          p_from: string
          p_seen: string[]
          p_to: string
          p_warehouses: string[]
        }
        Returns: Json
      }
      refresh_order_item_qty: { Args: never; Returns: Json }
      remove_order: { Args: { p_order_id: number }; Returns: Json }
      remove_order_from_trip: {
        Args: { p_order_id: number; p_trip_id: number }
        Returns: undefined
      }
      report_trip_issue: {
        Args: { p_note: string; p_trip_id: number }
        Returns: undefined
      }
      revoke_user: { Args: { p_user_id: number }; Returns: Json }
      save_pod: {
        Args: {
          p_lat?: number
          p_lng?: number
          p_notes?: string
          p_order_id: number
          p_photo_path?: string
          p_recipient_name: string
          p_signature_data: string
        }
        Returns: number
      }
      save_pod_with_photos: {
        Args: {
          p_lat?: number
          p_lng?: number
          p_notes?: string
          p_order_id: number
          p_photos?: Json
          p_recipient_name: string
          p_signature_data: string
        }
        Returns: number
      }
      set_stop_order: {
        Args: { p_order_ids: number[]; p_trip_id: number }
        Returns: undefined
      }
      start_trip: { Args: { p_trip_id: number }; Returns: undefined }
      suspected_duplicate_drivers: { Args: never; Returns: Json }
      sync_tms_trip_status: { Args: never; Returns: Json }
      tms_board: { Args: { p_date?: string }; Returns: Json }
      tms_login_gate: {
        Args: { p_key: string; p_limit: number; p_window: string }
        Returns: boolean
      }
      tms_login_sweep: { Args: never; Returns: undefined }
      tms_pull_coverage: { Args: { p_hours?: number }; Returns: Json }
      tms_sync_status: { Args: { p_date: string }; Returns: Json }
      tms_trip_detail: { Args: { p_tms_id: string }; Returns: Json }
      tracking_board: { Args: never; Returns: Json }
      trip_accept_state: { Args: { p_trip_id: number }; Returns: Json }
      trip_close_preview: { Args: { p_trip_id: number }; Returns: Json }
      trip_track: { Args: { p_trip_id: number }; Returns: Json }
      undo_cancel_stop: { Args: { p_order_ids: number[] }; Returns: Json }
      undo_deliver_order: { Args: { p_order_id: number }; Returns: Json }
      unverify_pod: {
        Args: { p_pod_id: number; p_reason: string }
        Returns: Json
      }
      usage_stats: { Args: never; Returns: Json }
      verify_pod: { Args: { p_pod_id: number }; Returns: Json }
    }
    Enums: {
      driver_status: "available" | "on_trip" | "off_duty"
      interaction_type: "call" | "email" | "meeting" | "line" | "other"
      order_priority: "normal" | "urgent"
      order_status:
        | "pending"
        | "assigned"
        | "in_transit"
        | "delivered"
        | "cancelled"
      pod_status: "collected" | "verified"
      quote_status: "draft" | "sent" | "accepted" | "rejected" | "expired"
      task_status: "pending" | "done"
      trip_status:
        | "planned"
        | "in_progress"
        | "returning"
        | "completed"
        | "cancelled"
      user_role: "admin" | "dispatcher" | "viewer" | "driver"
      vehicle_status: "available" | "on_trip" | "maintenance" | "inactive"
      vehicle_type: "pickup" | "truck6" | "truck10" | "reefer" | "van"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      driver_status: ["available", "on_trip", "off_duty"],
      interaction_type: ["call", "email", "meeting", "line", "other"],
      order_priority: ["normal", "urgent"],
      order_status: [
        "pending",
        "assigned",
        "in_transit",
        "delivered",
        "cancelled",
      ],
      pod_status: ["collected", "verified"],
      quote_status: ["draft", "sent", "accepted", "rejected", "expired"],
      task_status: ["pending", "done"],
      trip_status: [
        "planned",
        "in_progress",
        "returning",
        "completed",
        "cancelled",
      ],
      user_role: ["admin", "dispatcher", "viewer", "driver"],
      vehicle_status: ["available", "on_trip", "maintenance", "inactive"],
      vehicle_type: ["pickup", "truck6", "truck10", "reefer", "van"],
    },
  },
} as const
