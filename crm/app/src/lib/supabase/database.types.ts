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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          created_at: string
          details: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          module: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          module: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          module?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alertas: {
        Row: {
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          id: string
          module: string
          read: boolean
          tipo: Database["public"]["Enums"]["alerta_tipo"]
          title: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          module: string
          read?: boolean
          tipo: Database["public"]["Enums"]["alerta_tipo"]
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          module?: string
          read?: boolean
          tipo?: Database["public"]["Enums"]["alerta_tipo"]
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alertas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_sucursales: {
        Row: {
          cliente_id: string
          cp: string | null
          created_at: string
          direccion: string | null
          email: string | null
          id: string
          localidad: string | null
          nombre: string
          provincia: string | null
          telefono: string | null
        }
        Insert: {
          cliente_id: string
          cp?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          localidad?: string | null
          nombre: string
          provincia?: string | null
          telefono?: string | null
        }
        Update: {
          cliente_id?: string
          cp?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          localidad?: string | null
          nombre?: string
          provincia?: string | null
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_sucursales_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_sucursales_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          activo: boolean
          assigned_to: string | null
          condicion_iva: Database["public"]["Enums"]["condicion_iva_type"]
          cp: string | null
          created_at: string
          created_by: string | null
          cuit: string | null
          dias_cuenta_corriente: number
          direccion: string | null
          email: string | null
          forma_pago: string | null
          id: string
          limite_credito: number
          lista_precio: string | null
          localidad: string | null
          notas: string | null
          provincia: string | null
          razon_social: string
          saldo_cuenta_corriente: number
          telefono: string | null
          type: Database["public"]["Enums"]["client_type"]
          updated_at: string
        }
        Insert: {
          activo?: boolean
          assigned_to?: string | null
          condicion_iva?: Database["public"]["Enums"]["condicion_iva_type"]
          cp?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          dias_cuenta_corriente?: number
          direccion?: string | null
          email?: string | null
          forma_pago?: string | null
          id?: string
          limite_credito?: number
          lista_precio?: string | null
          localidad?: string | null
          notas?: string | null
          provincia?: string | null
          razon_social: string
          saldo_cuenta_corriente?: number
          telefono?: string | null
          type?: Database["public"]["Enums"]["client_type"]
          updated_at?: string
        }
        Update: {
          activo?: boolean
          assigned_to?: string | null
          condicion_iva?: Database["public"]["Enums"]["condicion_iva_type"]
          cp?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          dias_cuenta_corriente?: number
          direccion?: string | null
          email?: string | null
          forma_pago?: string | null
          id?: string
          limite_credito?: number
          lista_precio?: string | null
          localidad?: string | null
          notas?: string | null
          provincia?: string | null
          razon_social?: string
          saldo_cuenta_corriente?: number
          telefono?: string | null
          type?: Database["public"]["Enums"]["client_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contactos: {
        Row: {
          cargo: string | null
          created_at: string
          email: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["contacto_entity_type"]
          fecha_cumpleanos: string | null
          id: string
          nombre: string
          notas: string | null
          principal: boolean
          sucursal_id: string | null
          telefono: string | null
        }
        Insert: {
          cargo?: string | null
          created_at?: string
          email?: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["contacto_entity_type"]
          fecha_cumpleanos?: string | null
          id?: string
          nombre: string
          notas?: string | null
          principal?: boolean
          sucursal_id?: string | null
          telefono?: string | null
        }
        Update: {
          cargo?: string | null
          created_at?: string
          email?: string | null
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["contacto_entity_type"]
          fecha_cumpleanos?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          principal?: boolean
          sucursal_id?: string | null
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contactos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "cliente_sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      extracto_movimientos: {
        Row: {
          created_at: string
          descripcion: string
          estado: Database["public"]["Enums"]["extracto_mov_estado"]
          extracto_id: string
          fecha: string
          id: string
          match_cliente_id: string | null
          match_factura_id: string | null
          match_proveedor_id: string | null
          monto: number
          referencia: string | null
          tipo: Database["public"]["Enums"]["extracto_mov_tipo"]
        }
        Insert: {
          created_at?: string
          descripcion: string
          estado?: Database["public"]["Enums"]["extracto_mov_estado"]
          extracto_id: string
          fecha: string
          id?: string
          match_cliente_id?: string | null
          match_factura_id?: string | null
          match_proveedor_id?: string | null
          monto: number
          referencia?: string | null
          tipo: Database["public"]["Enums"]["extracto_mov_tipo"]
        }
        Update: {
          created_at?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["extracto_mov_estado"]
          extracto_id?: string
          fecha?: string
          id?: string
          match_cliente_id?: string | null
          match_factura_id?: string | null
          match_proveedor_id?: string | null
          monto?: number
          referencia?: string | null
          tipo?: Database["public"]["Enums"]["extracto_mov_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "extracto_movimientos_extracto_id_fkey"
            columns: ["extracto_id"]
            isOneToOne: false
            referencedRelation: "extractos_bancarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracto_movimientos_match_cliente_id_fkey"
            columns: ["match_cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracto_movimientos_match_cliente_id_fkey"
            columns: ["match_cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracto_movimientos_match_factura_id_fkey"
            columns: ["match_factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracto_movimientos_match_factura_id_fkey"
            columns: ["match_factura_id"]
            isOneToOne: false
            referencedRelation: "v_facturas_pendientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracto_movimientos_match_proveedor_id_fkey"
            columns: ["match_proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracto_movimientos_match_proveedor_id_fkey"
            columns: ["match_proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      extractos_bancarios: {
        Row: {
          archivo: string | null
          banco: string
          created_at: string
          created_by: string | null
          cuenta: string
          estado: Database["public"]["Enums"]["extracto_estado"]
          fecha_upload: string
          id: string
          periodo: string
          total_creditos: number
          total_debitos: number
        }
        Insert: {
          archivo?: string | null
          banco: string
          created_at?: string
          created_by?: string | null
          cuenta: string
          estado?: Database["public"]["Enums"]["extracto_estado"]
          fecha_upload?: string
          id?: string
          periodo: string
          total_creditos?: number
          total_debitos?: number
        }
        Update: {
          archivo?: string | null
          banco?: string
          created_at?: string
          created_by?: string | null
          cuenta?: string
          estado?: Database["public"]["Enums"]["extracto_estado"]
          fecha_upload?: string
          id?: string
          periodo?: string
          total_creditos?: number
          total_debitos?: number
        }
        Relationships: [
          {
            foreignKeyName: "extractos_bancarios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      factura_items: {
        Row: {
          cantidad: number
          descripcion: string
          factura_id: string
          id: string
          iva_porcentaje: number
          orden: number
          precio_unitario: number
          subtotal: number | null
        }
        Insert: {
          cantidad?: number
          descripcion: string
          factura_id: string
          id?: string
          iva_porcentaje?: number
          orden?: number
          precio_unitario: number
          subtotal?: number | null
        }
        Update: {
          cantidad?: number
          descripcion?: string
          factura_id?: string
          id?: string
          iva_porcentaje?: number
          orden?: number
          precio_unitario?: number
          subtotal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "factura_items_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factura_items_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "v_facturas_pendientes"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas: {
        Row: {
          cae: string | null
          cae_vencimiento: string | null
          cliente_id: string
          created_at: string
          created_by: string | null
          estado: Database["public"]["Enums"]["factura_status"]
          fecha: string
          id: string
          iva: number
          numero: number
          pdf_url: string | null
          presupuesto_id: string | null
          punto_venta: number
          subtotal: number
          tipo: Database["public"]["Enums"]["comprobante_type"]
          total: number
        }
        Insert: {
          cae?: string | null
          cae_vencimiento?: string | null
          cliente_id: string
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["factura_status"]
          fecha?: string
          id?: string
          iva?: number
          numero: number
          pdf_url?: string | null
          presupuesto_id?: string | null
          punto_venta?: number
          subtotal?: number
          tipo: Database["public"]["Enums"]["comprobante_type"]
          total?: number
        }
        Update: {
          cae?: string | null
          cae_vencimiento?: string | null
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["factura_status"]
          fecha?: string
          id?: string
          iva?: number
          numero?: number
          pdf_url?: string | null
          presupuesto_id?: string | null
          punto_venta?: number
          subtotal?: number
          tipo?: Database["public"]["Enums"]["comprobante_type"]
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "presupuestos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "v_presupuestos_completos"
            referencedColumns: ["id"]
          },
        ]
      }
      gastos_fijos: {
        Row: {
          activo: boolean
          categoria: string
          created_at: string
          created_by: string | null
          descripcion: string
          id: string
          moneda: string
          monto: number
          notas: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria?: string
          created_at?: string
          created_by?: string | null
          descripcion: string
          id?: string
          moneda?: string
          monto: number
          notas?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria?: string
          created_at?: string
          created_by?: string | null
          descripcion?: string
          id?: string
          moneda?: string
          monto?: number
          notas?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lineas_credito: {
        Row: {
          created_at: string
          created_by: string | null
          entidad: string
          estado: Database["public"]["Enums"]["linea_credito_estado"]
          id: string
          moneda: Database["public"]["Enums"]["moneda_type"]
          monto_disponible: number | null
          monto_total: number
          monto_utilizado: number
          notas: string | null
          proveedor_id: string | null
          tasa: number | null
          tipo: Database["public"]["Enums"]["linea_credito_tipo"]
          updated_at: string
          vencimiento: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entidad: string
          estado?: Database["public"]["Enums"]["linea_credito_estado"]
          id?: string
          moneda?: Database["public"]["Enums"]["moneda_type"]
          monto_disponible?: number | null
          monto_total: number
          monto_utilizado?: number
          notas?: string | null
          proveedor_id?: string | null
          tasa?: number | null
          tipo: Database["public"]["Enums"]["linea_credito_tipo"]
          updated_at?: string
          vencimiento: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entidad?: string
          estado?: Database["public"]["Enums"]["linea_credito_estado"]
          id?: string
          moneda?: Database["public"]["Enums"]["moneda_type"]
          monto_disponible?: number | null
          monto_total?: number
          monto_utilizado?: number
          notas?: string | null
          proveedor_id?: string | null
          tasa?: number | null
          tipo?: Database["public"]["Enums"]["linea_credito_tipo"]
          updated_at?: string
          vencimiento?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineas_credito_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_credito_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_credito_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      lista_precios_items: {
        Row: {
          categoria: string | null
          codigo: string
          created_at: string
          descripcion: string
          descuento: number | null
          id: string
          lista_id: string
          precio: number
          precio_neto: number | null
          producto_id: string | null
          unidad: string
        }
        Insert: {
          categoria?: string | null
          codigo: string
          created_at?: string
          descripcion: string
          descuento?: number | null
          id?: string
          lista_id: string
          precio: number
          precio_neto?: number | null
          producto_id?: string | null
          unidad?: string
        }
        Update: {
          categoria?: string | null
          codigo?: string
          created_at?: string
          descripcion?: string
          descuento?: number | null
          id?: string
          lista_id?: string
          precio?: number
          precio_neto?: number | null
          producto_id?: string | null
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "lista_precios_items_lista_id_fkey"
            columns: ["lista_id"]
            isOneToOne: false
            referencedRelation: "listas_precios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lista_precios_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lista_precios_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "v_stock_alertas"
            referencedColumns: ["id"]
          },
        ]
      }
      listas_precios: {
        Row: {
          archivo_origen: string | null
          created_at: string
          created_by: string | null
          estado: Database["public"]["Enums"]["lista_estado"]
          id: string
          moneda: Database["public"]["Enums"]["moneda_type"]
          nombre: string
          notas: string | null
          proveedor_id: string
          updated_at: string
          vigencia_desde: string
          vigencia_hasta: string
        }
        Insert: {
          archivo_origen?: string | null
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["lista_estado"]
          id?: string
          moneda?: Database["public"]["Enums"]["moneda_type"]
          nombre: string
          notas?: string | null
          proveedor_id: string
          updated_at?: string
          vigencia_desde: string
          vigencia_hasta: string
        }
        Update: {
          archivo_origen?: string | null
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["lista_estado"]
          id?: string
          moneda?: Database["public"]["Enums"]["moneda_type"]
          nombre?: string
          notas?: string | null
          proveedor_id?: string
          updated_at?: string
          vigencia_desde?: string
          vigencia_hasta?: string
        }
        Relationships: [
          {
            foreignKeyName: "listas_precios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listas_precios_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listas_precios_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos: {
        Row: {
          cliente_id: string | null
          conciliado: boolean
          created_at: string
          created_by: string | null
          descripcion: string
          extracto_movimiento_id: string | null
          factura_id: string | null
          fecha: string
          id: string
          moneda: Database["public"]["Enums"]["moneda_type"]
          monto: number
          proveedor_id: string | null
          tipo: Database["public"]["Enums"]["movimiento_tipo"]
        }
        Insert: {
          cliente_id?: string | null
          conciliado?: boolean
          created_at?: string
          created_by?: string | null
          descripcion: string
          extracto_movimiento_id?: string | null
          factura_id?: string | null
          fecha?: string
          id?: string
          moneda?: Database["public"]["Enums"]["moneda_type"]
          monto: number
          proveedor_id?: string | null
          tipo: Database["public"]["Enums"]["movimiento_tipo"]
        }
        Update: {
          cliente_id?: string | null
          conciliado?: boolean
          created_at?: string
          created_by?: string | null
          descripcion?: string
          extracto_movimiento_id?: string | null
          factura_id?: string | null
          fecha?: string
          id?: string
          moneda?: Database["public"]["Enums"]["moneda_type"]
          monto?: number
          proveedor_id?: string | null
          tipo?: Database["public"]["Enums"]["movimiento_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "fk_movimientos_extracto_mov"
            columns: ["extracto_movimiento_id"]
            isOneToOne: false
            referencedRelation: "extracto_movimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "v_facturas_pendientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      numeracion_secuencias: {
        Row: {
          anio: number
          id: string
          prefijo: string
          tipo: string
          ultimo_numero: number
          updated_at: string
        }
        Insert: {
          anio: number
          id?: string
          prefijo: string
          tipo: string
          ultimo_numero?: number
          updated_at?: string
        }
        Update: {
          anio?: number
          id?: string
          prefijo?: string
          tipo?: string
          ultimo_numero?: number
          updated_at?: string
        }
        Relationships: []
      }
      objetivos: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          id: string
          moneda: string
          monto_target: number
          nombre: string
          notas: string | null
          periodo_fin: string
          periodo_inicio: string
          tipo: string
          updated_at: string
          usuario_id: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          moneda?: string
          monto_target: number
          nombre: string
          notas?: string | null
          periodo_fin: string
          periodo_inicio: string
          tipo?: string
          updated_at?: string
          usuario_id?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          moneda?: string
          monto_target?: number
          nombre?: string
          notas?: string | null
          periodo_fin?: string
          periodo_inicio?: string
          tipo?: string
          updated_at?: string
          usuario_id?: string | null
        }
        Relationships: []
      }
      orden_compra_items: {
        Row: {
          cantidad: number
          cantidad_recibida: number
          codigo: string
          descripcion: string
          id: string
          orden: number
          orden_id: string
          precio_unitario: number
          producto_id: string | null
          subtotal: number | null
          unidad: string
        }
        Insert: {
          cantidad?: number
          cantidad_recibida?: number
          codigo: string
          descripcion: string
          id?: string
          orden?: number
          orden_id: string
          precio_unitario: number
          producto_id?: string | null
          subtotal?: number | null
          unidad?: string
        }
        Update: {
          cantidad?: number
          cantidad_recibida?: number
          codigo?: string
          descripcion?: string
          id?: string
          orden?: number
          orden_id?: string
          precio_unitario?: number
          producto_id?: string | null
          subtotal?: number | null
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "orden_compra_items_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_compra_items_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "v_ordenes_compra_progreso"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_compra_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orden_compra_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "v_stock_alertas"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_compra: {
        Row: {
          created_at: string
          created_by: string | null
          estado: Database["public"]["Enums"]["oc_status"]
          fecha: string
          fecha_entrega_estimada: string | null
          id: string
          iva: number
          moneda: Database["public"]["Enums"]["moneda_type"]
          numero: string | null
          observaciones: string | null
          presupuesto_origen_id: string | null
          proveedor_id: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["oc_status"]
          fecha?: string
          fecha_entrega_estimada?: string | null
          id?: string
          iva?: number
          moneda?: Database["public"]["Enums"]["moneda_type"]
          numero?: string | null
          observaciones?: string | null
          presupuesto_origen_id?: string | null
          proveedor_id: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["oc_status"]
          fecha?: string
          fecha_entrega_estimada?: string | null
          id?: string
          iva?: number
          moneda?: Database["public"]["Enums"]["moneda_type"]
          numero?: string | null
          observaciones?: string | null
          presupuesto_origen_id?: string | null
          proveedor_id?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_presupuesto_origen_id_fkey"
            columns: ["presupuesto_origen_id"]
            isOneToOne: false
            referencedRelation: "presupuestos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_presupuesto_origen_id_fkey"
            columns: ["presupuesto_origen_id"]
            isOneToOne: false
            referencedRelation: "v_presupuestos_completos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      precio_historial: {
        Row: {
          campo: string
          changed_by: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          valor_anterior: number | null
          valor_nuevo: number | null
        }
        Insert: {
          campo: string
          changed_by?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          valor_anterior?: number | null
          valor_nuevo?: number | null
        }
        Update: {
          campo?: string
          changed_by?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          valor_anterior?: number | null
          valor_nuevo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "precio_historial_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      presupuesto_items: {
        Row: {
          cantidad: number
          categoria: string | null
          codigo: string
          created_at: string
          descripcion: string
          id: string
          iva: number | null
          iva_porcentaje: number
          markup_porcentaje: number
          orden: number
          precio_costo: number
          precio_venta: number | null
          presupuesto_id: string
          producto_id: string | null
          subtotal: number | null
          total: number | null
          unidad: string
        }
        Insert: {
          cantidad?: number
          categoria?: string | null
          codigo: string
          created_at?: string
          descripcion: string
          id?: string
          iva?: number | null
          iva_porcentaje?: number
          markup_porcentaje?: number
          orden?: number
          precio_costo: number
          precio_venta?: number | null
          presupuesto_id: string
          producto_id?: string | null
          subtotal?: number | null
          total?: number | null
          unidad?: string
        }
        Update: {
          cantidad?: number
          categoria?: string | null
          codigo?: string
          created_at?: string
          descripcion?: string
          id?: string
          iva?: number | null
          iva_porcentaje?: number
          markup_porcentaje?: number
          orden?: number
          precio_costo?: number
          precio_venta?: number | null
          presupuesto_id?: string
          producto_id?: string | null
          subtotal?: number | null
          total?: number | null
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "presupuesto_items_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "presupuestos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_items_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "v_presupuestos_completos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "v_stock_alertas"
            referencedColumns: ["id"]
          },
        ]
      }
      presupuestos: {
        Row: {
          cliente_id: string
          created_at: string
          created_by: string | null
          enviado_at: string | null
          estado: Database["public"]["Enums"]["pr_status"]
          fecha: string
          id: string
          iva: number
          markup_general: number
          moneda: Database["public"]["Enums"]["moneda_type"]
          motivo_rechazo: string | null
          numero: string | null
          observaciones: string | null
          respondido_at: string | null
          subtotal: number
          total: number
          updated_at: string
          vencimiento: string
          vendedor_id: string | null
          version: number
        }
        Insert: {
          cliente_id: string
          created_at?: string
          created_by?: string | null
          enviado_at?: string | null
          estado?: Database["public"]["Enums"]["pr_status"]
          fecha?: string
          id?: string
          iva?: number
          markup_general?: number
          moneda?: Database["public"]["Enums"]["moneda_type"]
          motivo_rechazo?: string | null
          numero?: string | null
          observaciones?: string | null
          respondido_at?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
          vencimiento: string
          vendedor_id?: string | null
          version?: number
        }
        Update: {
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          enviado_at?: string | null
          estado?: Database["public"]["Enums"]["pr_status"]
          fecha?: string
          id?: string
          iva?: number
          markup_general?: number
          moneda?: Database["public"]["Enums"]["moneda_type"]
          motivo_rechazo?: string | null
          numero?: string | null
          observaciones?: string | null
          respondido_at?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
          vencimiento?: string
          vendedor_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "presupuestos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuestos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuestos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuestos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          categoria: string | null
          codigo: string
          created_at: string
          id: string
          iva: number
          moneda_costo: Database["public"]["Enums"]["moneda_type"]
          nombre: string
          precio_costo: number
          proveedor_id: string | null
          search_vector: unknown
          stock: number
          stock_minimo: number
          unidad: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria?: string | null
          codigo: string
          created_at?: string
          id?: string
          iva?: number
          moneda_costo?: Database["public"]["Enums"]["moneda_type"]
          nombre: string
          precio_costo?: number
          proveedor_id?: string | null
          search_vector?: unknown
          stock?: number
          stock_minimo?: number
          unidad?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria?: string | null
          codigo?: string
          created_at?: string
          id?: string
          iva?: number
          moneda_costo?: Database["public"]["Enums"]["moneda_type"]
          nombre?: string
          precio_costo?: number
          proveedor_id?: string | null
          search_vector?: unknown
          stock?: number
          stock_minimo?: number
          unidad?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "productos_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      proveedores: {
        Row: {
          activo: boolean
          clasificacion_nota: string | null
          clasificacion_tags: string[] | null
          condicion_iva: Database["public"]["Enums"]["condicion_iva_type"]
          created_at: string
          created_by: string | null
          cuit: string
          cuit_titular_cuenta: string | null
          cbu: string | null
          dias_cuenta_corriente: number
          direccion: string | null
          email: string | null
          forma_pago: string | null
          id: string
          limite_credito: number
          alias_bancario: string | null
          localidad: string | null
          marcas: string | null
          notas: string | null
          numero_cuenta: string | null
          provincia: string | null
          razon_social: string
          rubro: string | null
          saldo_cuenta_corriente: number
          telefono: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          clasificacion_nota?: string | null
          clasificacion_tags?: string[] | null
          condicion_iva?: Database["public"]["Enums"]["condicion_iva_type"]
          created_at?: string
          created_by?: string | null
          cuit: string
          cuit_titular_cuenta?: string | null
          cbu?: string | null
          dias_cuenta_corriente?: number
          direccion?: string | null
          email?: string | null
          forma_pago?: string | null
          id?: string
          limite_credito?: number
          alias_bancario?: string | null
          localidad?: string | null
          marcas?: string | null
          notas?: string | null
          numero_cuenta?: string | null
          provincia?: string | null
          razon_social: string
          rubro?: string | null
          saldo_cuenta_corriente?: number
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          clasificacion_nota?: string | null
          clasificacion_tags?: string[] | null
          condicion_iva?: Database["public"]["Enums"]["condicion_iva_type"]
          created_at?: string
          created_by?: string | null
          cuit?: string
          cuit_titular_cuenta?: string | null
          cbu?: string | null
          dias_cuenta_corriente?: number
          direccion?: string | null
          email?: string | null
          forma_pago?: string | null
          id?: string
          limite_credito?: number
          alias_bancario?: string | null
          localidad?: string | null
          marcas?: string | null
          notas?: string | null
          numero_cuenta?: string | null
          provincia?: string | null
          razon_social?: string
          rubro?: string | null
          saldo_cuenta_corriente?: number
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      remito_items: {
        Row: {
          cantidad: number
          descripcion: string
          id: string
          orden: number
          producto_id: string | null
          remito_id: string
          unidad: string
        }
        Insert: {
          cantidad?: number
          descripcion: string
          id?: string
          orden?: number
          producto_id?: string | null
          remito_id: string
          unidad?: string
        }
        Update: {
          cantidad?: number
          descripcion?: string
          id?: string
          orden?: number
          producto_id?: string | null
          remito_id?: string
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "remito_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remito_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "v_stock_alertas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remito_items_remito_id_fkey"
            columns: ["remito_id"]
            isOneToOne: false
            referencedRelation: "remitos"
            referencedColumns: ["id"]
          },
        ]
      }
      remitos: {
        Row: {
          cae: string | null
          cliente_id: string
          created_at: string
          created_by: string | null
          estado: Database["public"]["Enums"]["remito_status"]
          factura_id: string | null
          fecha: string
          id: string
          numero: string | null
          observaciones: string | null
          pdf_url: string | null
          presupuesto_id: string | null
        }
        Insert: {
          cae?: string | null
          cliente_id: string
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["remito_status"]
          factura_id?: string | null
          fecha?: string
          id?: string
          numero?: string | null
          observaciones?: string | null
          pdf_url?: string | null
          presupuesto_id?: string | null
        }
        Update: {
          cae?: string | null
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          estado?: Database["public"]["Enums"]["remito_status"]
          factura_id?: string | null
          fecha?: string
          id?: string
          numero?: string | null
          observaciones?: string | null
          pdf_url?: string | null
          presupuesto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remitos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "v_facturas_pendientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "presupuestos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remitos_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "v_presupuestos_completos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_comparador_precios: {
        Row: {
          categoria: string | null
          codigo: string | null
          descripcion: string | null
          descuento: number | null
          lista_estado: Database["public"]["Enums"]["lista_estado"] | null
          lista_nombre: string | null
          moneda: Database["public"]["Enums"]["moneda_type"] | null
          precio: number | null
          precio_neto: number | null
          proveedor: string | null
          unidad: string | null
          vigencia_hasta: string | null
        }
        Relationships: []
      }
      v_cuenta_corriente_clientes: {
        Row: {
          cuit: string | null
          dias_cuenta_corriente: number | null
          disponible: number | null
          estado_credito: string | null
          facturas_pendientes: number | null
          forma_pago: string | null
          id: string | null
          limite_credito: number | null
          monto_pendiente: number | null
          razon_social: string | null
          saldo: number | null
        }
        Insert: {
          cuit?: string | null
          dias_cuenta_corriente?: number | null
          disponible?: never
          estado_credito?: never
          facturas_pendientes?: never
          forma_pago?: string | null
          id?: string | null
          limite_credito?: number | null
          monto_pendiente?: never
          razon_social?: string | null
          saldo?: number | null
        }
        Update: {
          cuit?: string | null
          dias_cuenta_corriente?: number | null
          disponible?: never
          estado_credito?: never
          facturas_pendientes?: never
          forma_pago?: string | null
          id?: string | null
          limite_credito?: number | null
          monto_pendiente?: never
          razon_social?: string | null
          saldo?: number | null
        }
        Relationships: []
      }
      v_cuenta_corriente_proveedores: {
        Row: {
          cuit: string | null
          dias_cuenta_corriente: number | null
          disponible: number | null
          forma_pago: string | null
          id: string | null
          limite_credito: number | null
          oc_activas: number | null
          razon_social: string | null
          saldo: number | null
        }
        Insert: {
          cuit?: string | null
          dias_cuenta_corriente?: number | null
          disponible?: never
          forma_pago?: string | null
          id?: string | null
          limite_credito?: number | null
          oc_activas?: never
          razon_social?: string | null
          saldo?: number | null
        }
        Update: {
          cuit?: string | null
          dias_cuenta_corriente?: number | null
          disponible?: never
          forma_pago?: string | null
          id?: string | null
          limite_credito?: number | null
          oc_activas?: never
          razon_social?: string | null
          saldo?: number | null
        }
        Relationships: []
      }
      v_facturas_pendientes: {
        Row: {
          cae: string | null
          cae_vencimiento: string | null
          cliente_id: string | null
          cliente_nombre: string | null
          created_at: string | null
          created_by: string | null
          dias_cuenta_corriente: number | null
          dias_emitida: number | null
          estado: Database["public"]["Enums"]["factura_status"] | null
          fecha: string | null
          fecha_vencimiento_cc: string | null
          id: string | null
          iva: number | null
          numero: number | null
          pdf_url: string | null
          presupuesto_id: string | null
          punto_venta: number | null
          subtotal: number | null
          tipo: Database["public"]["Enums"]["comprobante_type"] | null
          total: number | null
          vencida_cc: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "presupuestos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "v_presupuestos_completos"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ordenes_compra_progreso: {
        Row: {
          creado_por_nombre: string | null
          created_at: string | null
          created_by: string | null
          estado: Database["public"]["Enums"]["oc_status"] | null
          fecha: string | null
          fecha_entrega_estimada: string | null
          id: string | null
          items_completos: number | null
          items_parciales: number | null
          iva: number | null
          moneda: Database["public"]["Enums"]["moneda_type"] | null
          numero: string | null
          observaciones: string | null
          porcentaje_recepcion: number | null
          presupuesto_origen_id: string | null
          proveedor_id: string | null
          proveedor_nombre: string | null
          subtotal: number | null
          total: number | null
          total_items: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_presupuesto_origen_id_fkey"
            columns: ["presupuesto_origen_id"]
            isOneToOne: false
            referencedRelation: "presupuestos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_presupuesto_origen_id_fkey"
            columns: ["presupuesto_origen_id"]
            isOneToOne: false
            referencedRelation: "v_presupuestos_completos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      v_presupuestos_completos: {
        Row: {
          cantidad_items: number | null
          cliente_condicion_iva:
            | Database["public"]["Enums"]["condicion_iva_type"]
            | null
          cliente_cuit: string | null
          cliente_id: string | null
          cliente_nombre: string | null
          created_at: string | null
          created_by: string | null
          dias_para_vencer: number | null
          enviado_at: string | null
          esta_vencido: boolean | null
          estado: Database["public"]["Enums"]["pr_status"] | null
          fecha: string | null
          id: string | null
          iva: number | null
          markup_general: number | null
          moneda: Database["public"]["Enums"]["moneda_type"] | null
          motivo_rechazo: string | null
          numero: string | null
          observaciones: string | null
          respondido_at: string | null
          subtotal: number | null
          total: number | null
          updated_at: string | null
          vencimiento: string | null
          vendedor_email: string | null
          vendedor_nombre: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "presupuestos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuestos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuestos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_alertas: {
        Row: {
          activo: boolean | null
          categoria: string | null
          codigo: string | null
          created_at: string | null
          faltante: number | null
          id: string | null
          iva: number | null
          moneda_costo: Database["public"]["Enums"]["moneda_type"] | null
          nivel_stock: string | null
          nombre: string | null
          precio_costo: number | null
          proveedor_id: string | null
          proveedor_nombre: string | null
          search_vector: unknown
          stock: number | null
          stock_minimo: number | null
          unidad: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "v_cuenta_corriente_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_write: { Args: never; Returns: boolean }
      check_listas_vencidas: { Args: never; Returns: undefined }
      check_presupuestos_vencidos: { Args: never; Returns: undefined }
      generate_document_number: {
        Args: { p_prefijo: string; p_tipo: string }
        Returns: string
      }
      get_dashboard_kpis: { Args: never; Returns: Json }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin_or_above: { Args: never; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      alerta_tipo:
        | "vencimiento_pr"
        | "stock_bajo"
        | "cc_vencida"
        | "cheque_proximo"
        | "seguimiento"
        | "oc_pendiente"
      client_type: "empresa" | "persona"
      comprobante_type:
        | "FA"
        | "FB"
        | "FC"
        | "NCA"
        | "NCB"
        | "NCC"
        | "NDA"
        | "NDB"
        | "NDC"
      condicion_iva_type: "RI" | "Monotributo" | "Exento" | "CF"
      contacto_entity_type: "cliente" | "proveedor"
      extracto_estado: "procesando" | "parcial" | "conciliado"
      extracto_mov_estado: "matcheado" | "pendiente" | "ignorado"
      extracto_mov_tipo: "credito" | "debito"
      factura_status: "emitida" | "pagada" | "anulada" | "vencida"
      linea_credito_estado: "activa" | "vencida" | "suspendida"
      linea_credito_tipo: "bancaria" | "proveedor"
      lista_estado: "vigente" | "vencida" | "borrador"
      moneda_type: "USD" | "ARS"
      movimiento_tipo:
        | "cobro"
        | "pago"
        | "cheque_emitido"
        | "cheque_recibido"
        | "transferencia"
        | "efectivo"
      oc_status:
        | "borrador"
        | "enviada"
        | "confirmada"
        | "recibida_parcial"
        | "recibida"
        | "cancelada"
      pr_status:
        | "borrador"
        | "pendiente"
        | "aprobado"
        | "rechazado"
        | "postergado"
        | "vencido"
      remito_status: "pendiente" | "entregado" | "parcial"
      user_role:
        | "super_admin"
        | "admin"
        | "vendedor"
        | "administrativo"
        | "viewer"
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
      alerta_tipo: [
        "vencimiento_pr",
        "stock_bajo",
        "cc_vencida",
        "cheque_proximo",
        "seguimiento",
        "oc_pendiente",
      ],
      client_type: ["empresa", "persona"],
      comprobante_type: [
        "FA",
        "FB",
        "FC",
        "NCA",
        "NCB",
        "NCC",
        "NDA",
        "NDB",
        "NDC",
      ],
      condicion_iva_type: ["RI", "Monotributo", "Exento", "CF"],
      contacto_entity_type: ["cliente", "proveedor"],
      extracto_estado: ["procesando", "parcial", "conciliado"],
      extracto_mov_estado: ["matcheado", "pendiente", "ignorado"],
      extracto_mov_tipo: ["credito", "debito"],
      factura_status: ["emitida", "pagada", "anulada", "vencida"],
      linea_credito_estado: ["activa", "vencida", "suspendida"],
      linea_credito_tipo: ["bancaria", "proveedor"],
      lista_estado: ["vigente", "vencida", "borrador"],
      moneda_type: ["USD", "ARS"],
      movimiento_tipo: [
        "cobro",
        "pago",
        "cheque_emitido",
        "cheque_recibido",
        "transferencia",
        "efectivo",
      ],
      oc_status: [
        "borrador",
        "enviada",
        "confirmada",
        "recibida_parcial",
        "recibida",
        "cancelada",
      ],
      pr_status: [
        "borrador",
        "pendiente",
        "aprobado",
        "rechazado",
        "postergado",
        "vencido",
      ],
      remito_status: ["pendiente", "entregado", "parcial"],
      user_role: [
        "super_admin",
        "admin",
        "vendedor",
        "administrativo",
        "viewer",
      ],
    },
  },
} as const
