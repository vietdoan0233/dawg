
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "adjustments": {
                  Row: {
                    "category_id": number,"created_at": string,"created_by": number | null,"guild_id": number,"id": number,"member_id": number,"points": number,"reason": string,"season_id": number
                  }
                  Insert: {
                    "category_id": number,"created_at"?: string,"created_by"?: number | null,"guild_id": number,"id"?: never,"member_id": number,"points": number,"reason": string,"season_id": number
                  }
                  Update: {
                    "category_id"?: number,"created_at"?: string,"created_by"?: number | null,"guild_id"?: number,"id"?: never,"member_id"?: number,"points"?: number,"reason"?: string,"season_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "adjustments_guild_id_season_id_category_id_fkey"
      columns: ["guild_id","season_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["guild_id","season_id","id"]
    },{
      foreignKeyName: "adjustments_guild_id_season_id_created_by_fkey"
      columns: ["guild_id","season_id","created_by"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["guild_id","season_id","id"]
    },{
      foreignKeyName: "adjustments_guild_id_season_id_member_id_fkey"
      columns: ["guild_id","season_id","member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["guild_id","season_id","id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "calls": number,"day": string,"user_id": string
                  }
                  Insert: {
                    "calls"?: number,"day": string,"user_id": string
                  }
                  Update: {
                    "calls"?: number,"day"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "color": string,"guild_id": number,"icon": string,"id": number,"name": string,"season_id": number
                  }
                  Insert: {
                    "color"?: string,"guild_id": number,"icon"?: string,"id"?: never,"name": string,"season_id": number
                  }
                  Update: {
                    "color"?: string,"guild_id"?: number,"icon"?: string,"id"?: never,"name"?: string,"season_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    }
                  ]
                },"events": {
                  Row: {
                    "ends_at": string,"guild_id": number,"id": number,"season_id": number,"starts_at": string,"task_id": number,"title": string
                  }
                  Insert: {
                    "ends_at": string,"guild_id": number,"id"?: never,"season_id": number,"starts_at": string,"task_id": number,"title": string
                  }
                  Update: {
                    "ends_at"?: string,"guild_id"?: number,"id"?: never,"season_id"?: number,"starts_at"?: string,"task_id"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    },{
      foreignKeyName: "events_guild_id_season_id_task_id_fkey"
      columns: ["guild_id","season_id","task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["guild_id","season_id","id"]
    }
                  ]
                },"guilds": {
                  Row: {
                    "created_at": string,"id": number,"name": string,"slug": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: never,"name": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"name"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"invites": {
                  Row: {
                    "code": string,"created_by": number | null,"expires_at": string,"guild_id": number,"max_uses": number,"revoked_at": string | null,"season_id": number,"used_count": number
                  }
                  Insert: {
                    "code"?: string,"created_by"?: number | null,"expires_at": string,"guild_id": number,"max_uses"?: number,"revoked_at"?: string | null,"season_id": number,"used_count"?: number
                  }
                  Update: {
                    "code"?: string,"created_by"?: number | null,"expires_at"?: string,"guild_id"?: number,"max_uses"?: number,"revoked_at"?: string | null,"season_id"?: number,"used_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invites_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    }
                  ]
                },"member_codes": {
                  Row: {
                    "code": string,"member_id": number
                  }
                  Insert: {
                    "code"?: string,"member_id": number
                  }
                  Update: {
                    "code"?: string,"member_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_codes_member_id_fkey"
      columns: ["member_id"]
isOneToOne: true
      referencedRelation: "member_tier"
      referencedColumns: ["member_id"]
    },{
      foreignKeyName: "member_codes_member_id_fkey"
      columns: ["member_id"]
isOneToOne: true
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"members": {
                  Row: {
                    "display_name": string,"email": string,"guild_id": number,"id": number,"role": string,"season_id": number,"tutor_group_id": number | null,"user_id": string | null
                  }
                  Insert: {
                    "display_name": string,"email": string,"guild_id": number,"id"?: never,"role"?: string,"season_id": number,"tutor_group_id"?: number | null,"user_id"?: string | null
                  }
                  Update: {
                    "display_name"?: string,"email"?: string,"guild_id"?: number,"id"?: never,"role"?: string,"season_id"?: number,"tutor_group_id"?: number | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    },{
      foreignKeyName: "members_guild_id_season_id_tutor_group_id_fkey"
      columns: ["guild_id","season_id","tutor_group_id"]
isOneToOne: false
      referencedRelation: "tutor_groups"
      referencedColumns: ["guild_id","season_id","id"]
    }
                  ]
                },"rules": {
                  Row: {
                    "category_id": number,"guild_id": number,"id": number,"min_points": number,"season_id": number,"tier_id": number | null
                  }
                  Insert: {
                    "category_id": number,"guild_id": number,"id"?: never,"min_points": number,"season_id": number,"tier_id"?: number | null
                  }
                  Update: {
                    "category_id"?: number,"guild_id"?: number,"id"?: never,"min_points"?: number,"season_id"?: number,"tier_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rules_guild_id_season_id_category_id_fkey"
      columns: ["guild_id","season_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["guild_id","season_id","id"]
    },{
      foreignKeyName: "rules_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    },{
      foreignKeyName: "rules_guild_id_season_id_tier_id_fkey"
      columns: ["guild_id","season_id","tier_id"]
isOneToOne: false
      referencedRelation: "tiers"
      referencedColumns: ["guild_id","season_id","id"]
    }
                  ]
                },"seasons": {
                  Row: {
                    "ends_on": string,"guild_id": number,"id": number,"is_current": boolean,"name": string,"starts_on": string
                  }
                  Insert: {
                    "ends_on": string,"guild_id": number,"id"?: never,"is_current"?: boolean,"name": string,"starts_on": string
                  }
                  Update: {
                    "ends_on"?: string,"guild_id"?: number,"id"?: never,"is_current"?: boolean,"name"?: string,"starts_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "seasons_guild_id_fkey"
      columns: ["guild_id"]
isOneToOne: false
      referencedRelation: "guilds"
      referencedColumns: ["id"]
    }
                  ]
                },"submissions": {
                  Row: {
                    "award_reason": string | null,"category_id": number,"created_at": string,"event_id": number | null,"guild_id": number,"id": number,"member_id": number,"note": string | null,"photo_path": string | null,"photo_sha256": string | null,"points_awarded": number | null,"reviewed_at": string | null,"reviewed_by": number | null,"season_id": number,"status": string,"task_id": number
                  }
                  Insert: {
                    "award_reason"?: string | null,"category_id": number,"created_at"?: string,"event_id"?: number | null,"guild_id": number,"id"?: never,"member_id": number,"note"?: string | null,"photo_path"?: string | null,"photo_sha256"?: string | null,"points_awarded"?: number | null,"reviewed_at"?: string | null,"reviewed_by"?: number | null,"season_id": number,"status"?: string,"task_id": number
                  }
                  Update: {
                    "award_reason"?: string | null,"category_id"?: number,"created_at"?: string,"event_id"?: number | null,"guild_id"?: number,"id"?: never,"member_id"?: number,"note"?: string | null,"photo_path"?: string | null,"photo_sha256"?: string | null,"points_awarded"?: number | null,"reviewed_at"?: string | null,"reviewed_by"?: number | null,"season_id"?: number,"status"?: string,"task_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "submissions_guild_id_season_id_event_id_fkey"
      columns: ["guild_id","season_id","event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["guild_id","season_id","id"]
    },{
      foreignKeyName: "submissions_guild_id_season_id_member_id_fkey"
      columns: ["guild_id","season_id","member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["guild_id","season_id","id"]
    },{
      foreignKeyName: "submissions_guild_id_season_id_reviewed_by_fkey"
      columns: ["guild_id","season_id","reviewed_by"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["guild_id","season_id","id"]
    },{
      foreignKeyName: "submissions_guild_id_season_id_task_id_category_id_fkey"
      columns: ["guild_id","season_id","task_id","category_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["guild_id","season_id","id","category_id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "active": boolean,"category_id": number,"description": string | null,"guild_id": number,"id": number,"max_repeats": number,"points_max": number,"points_min": number,"required": boolean,"requires_note": boolean,"requires_photo": boolean,"revealed_at": string,"reviewer": string,"season_id": number,"title": string
                  }
                  Insert: {
                    "active"?: boolean,"category_id": number,"description"?: string | null,"guild_id": number,"id"?: never,"max_repeats"?: number,"points_max": number,"points_min": number,"required"?: boolean,"requires_note"?: boolean,"requires_photo"?: boolean,"revealed_at"?: string,"reviewer"?: string,"season_id": number,"title": string
                  }
                  Update: {
                    "active"?: boolean,"category_id"?: number,"description"?: string | null,"guild_id"?: number,"id"?: never,"max_repeats"?: number,"points_max"?: number,"points_min"?: number,"required"?: boolean,"requires_note"?: boolean,"requires_photo"?: boolean,"revealed_at"?: string,"reviewer"?: string,"season_id"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_guild_id_season_id_category_id_fkey"
      columns: ["guild_id","season_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["guild_id","season_id","id"]
    },{
      foreignKeyName: "tasks_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    }
                  ]
                },"tiers": {
                  Row: {
                    "guild_id": number,"id": number,"min_total": number,"name": string,"season_id": number
                  }
                  Insert: {
                    "guild_id": number,"id"?: never,"min_total": number,"name": string,"season_id": number
                  }
                  Update: {
                    "guild_id"?: number,"id"?: never,"min_total"?: number,"name"?: string,"season_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "tiers_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    }
                  ]
                },"tutor_groups": {
                  Row: {
                    "guild_id": number,"id": number,"name": string,"season_id": number
                  }
                  Insert: {
                    "guild_id": number,"id"?: never,"name": string,"season_id": number
                  }
                  Update: {
                    "guild_id"?: number,"id"?: never,"name"?: string,"season_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "tutor_groups_guild_id_season_id_fkey"
      columns: ["guild_id","season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["guild_id","id"]
    }
                  ]
                }
          }
          Views: {
            "member_tier": {
                  Row: {
                    "member_id": number | null,"tier_id": number | null
                  }
                  Relationships: [
                    
                  ]
                },"progress": {
                  Row: {
                    "category_id": number | null,"member_id": number | null,"points": number | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "award_task":
{ Args: { "p_event_id": number,"p_member_id": number,"p_points": number,"p_reason": string,"p_reviewer_id": number,"p_source": string,"p_submission_id"?: number,"p_task_id": number }; Returns: string
                           },
"bootstrap_guild":
{ Args: { "p_captain_email": string,"p_name": string,"p_slug": string }; Returns: string
                           },
"checkin":
{ Args: { "p_event_id": number,"p_member_code": string,"p_scanned_at": string }; Returns: string
                           },
"create_invite":
{ Args: { "p_days"?: number,"p_guild_id": number,"p_max_uses"?: number }; Returns: string
                           },
"current_season":
{ Args: { "p_guild_id": number }; Returns: number
                           },
"has_role":
{ Args: { "p_guild_id": number,"p_roles": (string)[] }; Returns: boolean
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"hook_custom_access_token":
{ Args: { "event": Json }; Returns: Json
                           },
"is_member":
{ Args: { "p_guild_id": number }; Returns: boolean
                           },
"is_tutor_of":
{ Args: { "p_member_id": number }; Returns: boolean
                           },
"join_guild":
{ Args: { "p_code": string }; Returns: number
                           },
"leaderboard":
{ Args: { "p_guild_id": number }; Returns: {
              "group_id": number,"group_name": string,"total_points": number
            }[]
                           },
"list_invites":
{ Args: { "p_guild_id": number }; Returns: {
              "code": string,"expires_at": string,"max_uses": number,"revoked_at": string,"used_count": number
            }[]
                           },
"my_code":
{ Args: { "p_guild_id": number }; Returns: string
                           },
"my_member_id":
{ Args: { "p_guild_id": number }; Returns: number
                           },
"proof_owner":
{ Args: { "p_name": string }; Returns: (number)[]
                           },
"required_missing":
{ Args: { "p_member_id": number }; Returns: boolean
                           },
"review_submissions":
{ Args: { "p_approve": boolean,"p_ids": (number)[],"p_points"?: number,"p_reason"?: string }; Returns: {
              "result": string,"submission_id": number
            }[]
                           },
"revoke_invite":
{ Args: { "p_code": string }; Returns: undefined
                           },
"roadmap":
{ Args: { "p_guild_id": number }; Returns: Json
                           },
"rotate_my_code":
{ Args: { "p_guild_id": number }; Returns: string
                           },
"set_role":
{ Args: { "p_member_id": number,"p_role": string,"p_tutor_group_id"?: number }; Returns: undefined
                           },
"submit_task":
{ Args: { "p_note"?: string,"p_photo_path"?: string,"p_photo_sha256"?: string,"p_task_id": number,"p_with_member_ids"?: (number)[] }; Returns: number
                           },
"task_visible":
{ Args: { "p_task_id": number }; Returns: boolean
                           },
"update_task":
{ Args: { "p_reveal"?: boolean,"p_task_id": number }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
