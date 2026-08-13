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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      assignment_files: {
        Row: {
          assignment_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_object_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_files_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_targets: {
        Row: {
          assigned_at: string
          assignment_id: string
          class_id: string | null
          created_at: string
          id: string
          revoked_at: string | null
          student_id: string | null
        }
        Insert: {
          assigned_at?: string
          assignment_id: string
          class_id?: string | null
          created_at?: string
          id?: string
          revoked_at?: string | null
          student_id?: string | null
        }
        Update: {
          assigned_at?: string
          assignment_id?: string
          class_id?: string | null
          created_at?: string
          id?: string
          revoked_at?: string | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_targets_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_targets_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_targets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          published_at: string | null
          teacher_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          published_at?: string | null
          teacher_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          published_at?: string | null
          teacher_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_submission_files: {
        Row: {
          audio_submission_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          task_word_id: string | null
        }
        Insert: {
          audio_submission_id: string
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          task_word_id?: string | null
        }
        Update: {
          audio_submission_id?: string
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_object_key?: string
          task_word_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audio_submission_files_audio_submission_id_fkey"
            columns: ["audio_submission_id"]
            isOneToOne: false
            referencedRelation: "audio_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_submission_files_task_word_id_fkey"
            columns: ["task_word_id"]
            isOneToOne: false
            referencedRelation: "pronunciation_task_words"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_submissions: {
        Row: {
          attempt_no: number
          created_at: string
          feedback_text: string | null
          graded_at: string | null
          id: string
          note: string | null
          score: number | null
          student_id: string
          submitted_at: string | null
          task_id: string
        }
        Insert: {
          attempt_no: number
          created_at?: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          note?: string | null
          score?: number | null
          student_id: string
          submitted_at?: string | null
          task_id: string
        }
        Update: {
          attempt_no?: number
          created_at?: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          note?: string | null
          score?: number | null
          student_id?: string
          submitted_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pronunciation_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          created_at: string
          detail: Json
          error_code: string | null
          id: string
          outcome: string
          request_id: string
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_type: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          error_code?: string | null
          id?: string
          outcome: string
          request_id: string
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          error_code?: string | null
          id?: string
          outcome?: string
          request_id?: string
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: []
      }
      classes: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          class_id: string
          created_at: string
          enrolled_at: string
          id: string
          student_id: string
          unenrolled_at: string | null
        }
        Insert: {
          class_id: string
          created_at?: string
          enrolled_at?: string
          id?: string
          student_id: string
          unenrolled_at?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string
          enrolled_at?: string
          id?: string
          student_id?: string
          unenrolled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_score_files: {
        Row: {
          created_at: string
          exam_score_id: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
        }
        Insert: {
          created_at?: string
          exam_score_id: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
        }
        Update: {
          created_at?: string
          exam_score_id?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_object_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_score_files_exam_score_id_fkey"
            columns: ["exam_score_id"]
            isOneToOne: false
            referencedRelation: "exam_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_scores: {
        Row: {
          created_at: string
          exam_id: string
          feedback_text: string | null
          graded_at: string | null
          id: string
          score: number | null
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          score?: number | null
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          score?: number | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_scores_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_scores_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_source_classes: {
        Row: {
          class_id: string
          created_at: string
          exam_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          exam_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          exam_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_source_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_source_classes_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          exam_date: string
          full_marks: number | null
          id: string
          teacher_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          exam_date: string
          full_marks?: number | null
          id?: string
          teacher_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          exam_date?: string
          full_marks?: number | null
          id?: string
          teacher_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_summaries: {
        Row: {
          archived_at: string | null
          content: string
          created_at: string
          id: string
          session_date: string
          teacher_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          content: string
          created_at?: string
          id?: string
          session_date: string
          teacher_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          content?: string
          created_at?: string
          id?: string
          session_date?: string
          teacher_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_summaries_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_summary_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          summary_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          summary_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_object_key?: string
          summary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_summary_files_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "lesson_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_summary_source_classes: {
        Row: {
          class_id: string
          created_at: string
          summary_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          summary_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          summary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_summary_source_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_summary_source_classes_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "lesson_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_summary_targets: {
        Row: {
          created_at: string
          student_id: string
          summary_id: string
        }
        Insert: {
          created_at?: string
          student_id: string
          summary_id: string
        }
        Update: {
          created_at?: string
          student_id?: string
          summary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_summary_targets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_summary_targets_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "lesson_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_session_tab_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          session_id: string
          student_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          session_id: string
          student_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          session_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_session_tab_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_session_tab_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_session_words: {
        Row: {
          autoplay_audio: boolean
          choices: Json
          correct_answer: string
          correct_answers: string[]
          created_at: string
          input_mode: string
          play_audio: boolean
          prompt_image_url: string | null
          prompt_meaning: string | null
          prompt_question: string | null
          prompt_term: string | null
          prompt_text: string
          session_id: string
          show_chinese: boolean
          show_english: boolean
          sort_order: number
          source_sort_order: number | null
          word_id: string
        }
        Insert: {
          autoplay_audio?: boolean
          choices?: Json
          correct_answer: string
          correct_answers?: string[]
          created_at?: string
          input_mode?: string
          play_audio?: boolean
          prompt_image_url?: string | null
          prompt_meaning?: string | null
          prompt_question?: string | null
          prompt_term?: string | null
          prompt_text: string
          session_id: string
          show_chinese?: boolean
          show_english?: boolean
          sort_order: number
          source_sort_order?: number | null
          word_id: string
        }
        Update: {
          autoplay_audio?: boolean
          choices?: Json
          correct_answer?: string
          correct_answers?: string[]
          created_at?: string
          input_mode?: string
          play_audio?: boolean
          prompt_image_url?: string | null
          prompt_meaning?: string | null
          prompt_question?: string | null
          prompt_term?: string | null
          prompt_text?: string
          session_id?: string
          show_chinese?: boolean
          show_english?: boolean
          sort_order?: number
          source_sort_order?: number | null
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_session_words_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_session_words_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sessions: {
        Row: {
          allow_student_order_choice: boolean
          audio_word_count: number
          completed_at: string | null
          created_at: string
          default_word_order: string
          id: string
          practice_engine_version: number
          selected_word_order: string | null
          set_id: string
          started_at: string
          student_id: string
          total_words: number
        }
        Insert: {
          allow_student_order_choice?: boolean
          audio_word_count?: number
          completed_at?: string | null
          created_at?: string
          default_word_order?: string
          id?: string
          practice_engine_version?: number
          selected_word_order?: string | null
          set_id: string
          started_at?: string
          student_id: string
          total_words: number
        }
        Update: {
          allow_student_order_choice?: boolean
          audio_word_count?: number
          completed_at?: string | null
          created_at?: string
          default_word_order?: string
          id?: string
          practice_engine_version?: number
          selected_word_order?: string | null
          set_id?: string
          started_at?: string
          student_id?: string
          total_words?: number
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          must_change_password: boolean
          role: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          must_change_password?: boolean
          role: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          role?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      pronunciation_targets: {
        Row: {
          assigned_at: string
          class_id: string | null
          created_at: string
          id: string
          revoked_at: string | null
          student_id: string | null
          task_id: string
        }
        Insert: {
          assigned_at?: string
          class_id?: string | null
          created_at?: string
          id?: string
          revoked_at?: string | null
          student_id?: string | null
          task_id: string
        }
        Update: {
          assigned_at?: string
          class_id?: string | null
          created_at?: string
          id?: string
          revoked_at?: string | null
          student_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pronunciation_targets_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pronunciation_targets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pronunciation_targets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pronunciation_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      pronunciation_task_words: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          sort_order: number
          task_id: string
          text_prompt: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          task_id: string
          text_prompt: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          task_id?: string
          text_prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pronunciation_task_words_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pronunciation_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      pronunciation_tasks: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          published_at: string | null
          teacher_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          published_at?: string | null
          teacher_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          published_at?: string | null
          teacher_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pronunciation_tasks_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          created_at: string
          id: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          id: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          submission_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          submission_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_object_key?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          assignment_id: string
          attempt_no: number
          created_at: string
          feedback_text: string | null
          graded_at: string | null
          id: string
          note: string | null
          score: number | null
          student_id: string
          submitted_at: string | null
        }
        Insert: {
          assignment_id: string
          attempt_no: number
          created_at?: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          note?: string | null
          score?: number | null
          student_id: string
          submitted_at?: string | null
        }
        Update: {
          assignment_id?: string
          attempt_no?: number
          created_at?: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          note?: string | null
          score?: number | null
          student_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teachers_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_intents: {
        Row: {
          created_at: string
          declared_size_bytes: number
          expires_at: string
          file_name: string
          finalized_at: string | null
          id: string
          mime_type: string
          purpose: string
          status: string
          storage_object_key: string
          subject_id: string
          task_word_id: string | null
          uploader_id: string
          vocabulary_word_id: string | null
        }
        Insert: {
          created_at?: string
          declared_size_bytes: number
          expires_at: string
          file_name: string
          finalized_at?: string | null
          id?: string
          mime_type: string
          purpose: string
          status?: string
          storage_object_key: string
          subject_id: string
          task_word_id?: string | null
          uploader_id: string
          vocabulary_word_id?: string | null
        }
        Update: {
          created_at?: string
          declared_size_bytes?: number
          expires_at?: string
          file_name?: string
          finalized_at?: string | null
          id?: string
          mime_type?: string
          purpose?: string
          status?: string
          storage_object_key?: string
          subject_id?: string
          task_word_id?: string | null
          uploader_id?: string
          vocabulary_word_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_intents_task_word_id_fkey"
            columns: ["task_word_id"]
            isOneToOne: false
            referencedRelation: "pronunciation_task_words"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_intents_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_intents_vocabulary_word_id_fkey"
            columns: ["vocabulary_word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_attempts: {
        Row: {
          answered_at: string
          attempt_no: number
          correct_answer: string
          correct_answers: string[]
          created_at: string
          id: string
          input_mode: string
          is_correct: boolean
          prompt_term: string | null
          prompt_text: string
          session_id: string
          submitted_spelling: string
          word_id: string
        }
        Insert: {
          answered_at?: string
          attempt_no?: number
          correct_answer: string
          correct_answers?: string[]
          created_at?: string
          id?: string
          input_mode?: string
          is_correct: boolean
          prompt_term?: string | null
          prompt_text: string
          session_id: string
          submitted_spelling: string
          word_id: string
        }
        Update: {
          answered_at?: string
          attempt_no?: number
          correct_answer?: string
          correct_answers?: string[]
          created_at?: string
          id?: string
          input_mode?: string
          is_correct?: boolean
          prompt_term?: string | null
          prompt_text?: string
          session_id?: string
          submitted_spelling?: string
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_attempts_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_audio_submission_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          vocabulary_audio_submission_id: string
          word_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_object_key: string
          vocabulary_audio_submission_id: string
          word_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_object_key?: string
          vocabulary_audio_submission_id?: string
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_audio_submission_f_vocabulary_audio_submission__fkey"
            columns: ["vocabulary_audio_submission_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_audio_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_audio_submission_files_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_audio_submissions: {
        Row: {
          attempt_no: number
          created_at: string
          feedback_text: string | null
          graded_at: string | null
          id: string
          note: string | null
          score: number | null
          session_id: string
          set_id: string
          student_id: string
          submitted_at: string | null
        }
        Insert: {
          attempt_no: number
          created_at?: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          note?: string | null
          score?: number | null
          session_id: string
          set_id: string
          student_id: string
          submitted_at?: string | null
        }
        Update: {
          attempt_no?: number
          created_at?: string
          feedback_text?: string | null
          graded_at?: string | null
          id?: string
          note?: string | null
          score?: number | null
          session_id?: string
          set_id?: string
          student_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_audio_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_audio_submissions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_audio_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_sets: {
        Row: {
          allow_student_order_choice: boolean
          archived_at: string | null
          audio_only: boolean
          created_at: string
          description: string | null
          display_autoplay_audio: boolean
          display_play_audio: boolean
          display_show_chinese: boolean
          display_show_english: boolean
          due_at: string | null
          id: string
          input_mode: string
          practice_engine_version: number
          prompt_field: string
          published_at: string | null
          show_image: boolean
          teacher_id: string
          title: string
          updated_at: string
          word_order: string
        }
        Insert: {
          allow_student_order_choice?: boolean
          archived_at?: string | null
          audio_only?: boolean
          created_at?: string
          description?: string | null
          display_autoplay_audio?: boolean
          display_play_audio?: boolean
          display_show_chinese?: boolean
          display_show_english?: boolean
          due_at?: string | null
          id?: string
          input_mode?: string
          practice_engine_version?: number
          prompt_field?: string
          published_at?: string | null
          show_image?: boolean
          teacher_id: string
          title: string
          updated_at?: string
          word_order?: string
        }
        Update: {
          allow_student_order_choice?: boolean
          archived_at?: string | null
          audio_only?: boolean
          created_at?: string
          description?: string | null
          display_autoplay_audio?: boolean
          display_play_audio?: boolean
          display_show_chinese?: boolean
          display_show_english?: boolean
          due_at?: string | null
          id?: string
          input_mode?: string
          practice_engine_version?: number
          prompt_field?: string
          published_at?: string | null
          show_image?: boolean
          teacher_id?: string
          title?: string
          updated_at?: string
          word_order?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_sets_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_targets: {
        Row: {
          assigned_at: string
          created_at: string
          id: string
          revoked_at: string | null
          set_id: string
          student_id: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          set_id: string
          student_id: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          set_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_targets_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_targets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_word_alt_meanings: {
        Row: {
          alt_meaning: string
          created_at: string
          id: string
          sort_order: number
          word_id: string
        }
        Insert: {
          alt_meaning: string
          created_at?: string
          id?: string
          sort_order?: number
          word_id: string
        }
        Update: {
          alt_meaning?: string
          created_at?: string
          id?: string
          sort_order?: number
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_word_alt_meanings_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_word_alt_terms: {
        Row: {
          alt_term: string
          created_at: string
          id: string
          sort_order: number
          word_id: string
        }
        Insert: {
          alt_term: string
          created_at?: string
          id?: string
          sort_order?: number
          word_id: string
        }
        Update: {
          alt_term?: string
          created_at?: string
          id?: string
          sort_order?: number
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_word_alt_terms_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_word_choices: {
        Row: {
          choice_text: string
          created_at: string
          id: string
          is_correct: boolean
          sort_order: number
          word_id: string
        }
        Insert: {
          choice_text: string
          created_at?: string
          id?: string
          is_correct?: boolean
          sort_order?: number
          word_id: string
        }
        Update: {
          choice_text?: string
          created_at?: string
          id?: string
          is_correct?: boolean
          sort_order?: number
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_word_choices_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_words: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          image_url: string | null
          meaning: string
          override_autoplay_audio: boolean | null
          override_input_mode: string | null
          override_play_audio: boolean | null
          override_show_chinese: boolean | null
          override_show_english: boolean | null
          override_show_image: boolean | null
          question_prompt: string | null
          set_id: string
          sort_order: number
          term: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          meaning: string
          override_autoplay_audio?: boolean | null
          override_input_mode?: string | null
          override_play_audio?: boolean | null
          override_show_chinese?: boolean | null
          override_show_english?: boolean | null
          override_show_image?: boolean | null
          question_prompt?: string | null
          set_id: string
          sort_order?: number
          term: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          meaning?: string
          override_autoplay_audio?: boolean | null
          override_input_mode?: string | null
          override_play_audio?: boolean | null
          override_show_chinese?: boolean | null
          override_show_english?: boolean | null
          override_show_image?: boolean | null
          question_prompt?: string | null
          set_id?: string
          sort_order?: number
          term?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_words_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_sets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_students_to_exam: {
        Args: {
          p_exam_id: string
          p_source_class_ids?: string[]
          p_student_ids: string[]
        }
        Returns: undefined
      }
      add_students_to_lesson_summary: {
        Args: {
          p_source_class_ids?: string[]
          p_student_ids: string[]
          p_summary_id: string
        }
        Returns: undefined
      }
      add_vocabulary_words_with_answers: {
        Args: { p_set_id: string; p_words: Json }
        Returns: undefined
      }
      assign_assignment_to_targets: {
        Args: {
          p_assignment_id: string
          p_class_ids: string[]
          p_student_ids: string[]
        }
        Returns: undefined
      }
      assign_pronunciation_task_to_targets: {
        Args: {
          p_class_ids: string[]
          p_student_ids: string[]
          p_task_id: string
        }
        Returns: undefined
      }
      assign_vocabulary_set_to_students: {
        Args: { p_set_id: string; p_student_ids: string[] }
        Returns: undefined
      }
      begin_upload: {
        Args: {
          p_file_name: string
          p_mime_type: string
          p_purpose: string
          p_size_bytes: number
          p_subject_id: string
          p_task_word_id?: string
        }
        Returns: {
          intent_id: string
          storage_object_key: string
        }[]
      }
      begin_upload_v2: {
        Args: {
          p_file_name: string
          p_mime_type: string
          p_purpose: string
          p_size_bytes: number
          p_subject_id: string
          p_task_word_id?: string
          p_vocabulary_word_id?: string
        }
        Returns: {
          intent_id: string
          storage_object_key: string
        }[]
      }
      cancel_upload: { Args: { p_intent_id: string }; Returns: undefined }
      complete_password_change: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      complete_practice_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      complete_practice_session_v2: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      create_and_publish_assignment: {
        Args: {
          p_class_ids: string[]
          p_description: string
          p_due_at: string
          p_student_ids: string[]
          p_title: string
        }
        Returns: string
      }
      create_and_publish_pronunciation_task: {
        Args: {
          p_class_ids: string[]
          p_description: string
          p_due_at: string
          p_student_ids: string[]
          p_title: string
        }
        Returns: string
      }
      create_and_publish_vocabulary_set: {
        Args: {
          p_audio_only: boolean
          p_description: string
          p_due_at: string
          p_prompt_field: string
          p_show_image: boolean
          p_student_ids: string[]
          p_title: string
        }
        Returns: string
      }
      create_and_publish_vocabulary_set_v2: {
        Args: {
          p_allow_student_order_choice: boolean
          p_description: string
          p_display_autoplay_audio: boolean
          p_display_play_audio: boolean
          p_display_show_chinese: boolean
          p_display_show_english: boolean
          p_due_at: string
          p_input_mode: string
          p_show_image: boolean
          p_student_ids: string[]
          p_title: string
          p_word_order: string
        }
        Returns: string
      }
      create_audio_submission: {
        Args: { p_note: string; p_task_id: string }
        Returns: string
      }
      create_exam_with_students: {
        Args: {
          p_description: string
          p_exam_date: string
          p_full_marks: number
          p_source_class_ids?: string[]
          p_student_ids: string[]
          p_title: string
        }
        Returns: string
      }
      create_lesson_summary_with_students: {
        Args: {
          p_content: string
          p_session_date: string
          p_source_class_ids?: string[]
          p_student_ids: string[]
          p_title: string
        }
        Returns: string
      }
      create_submission: {
        Args: { p_assignment_id: string; p_note: string }
        Returns: string
      }
      create_vocabulary_audio_submission: {
        Args: { p_note?: string; p_session_id: string }
        Returns: string
      }
      create_vocabulary_set_with_words: {
        Args: { p_description: string; p_title: string; p_words: Json }
        Returns: string
      }
      delete_exam_score_file: {
        Args: { p_file_id: string }
        Returns: undefined
      }
      delete_lesson_summary_file: {
        Args: { p_file_id: string }
        Returns: undefined
      }
      enroll_students_in_class: {
        Args: { p_class_id: string; p_student_ids: string[] }
        Returns: undefined
      }
      finalize_student_creation: {
        Args: {
          p_full_name: string
          p_request_id: string
          p_teacher_id: string
          p_user_id: string
          p_username: string
        }
        Returns: boolean
      }
      finalize_teacher_bootstrap: {
        Args: {
          p_full_name: string
          p_request_id: string
          p_user_id: string
          p_username: string
        }
        Returns: boolean
      }
      finalize_upload: { Args: { p_intent_id: string }; Returns: string }
      finalize_upload_v2: { Args: { p_intent_id: string }; Returns: string }
      finish_audio_submission: {
        Args: { p_audio_submission_id: string }
        Returns: undefined
      }
      finish_submission: {
        Args: { p_submission_id: string }
        Returns: undefined
      }
      get_practice_session_state_v2: {
        Args: { p_session_id: string }
        Returns: {
          allow_student_order_choice: boolean
          audio_word_count: number
          completed_at: string
          completed_audio_count: number
          completed_typed_count: number
          default_word_order: string
          selected_word_order: string
          total_words: number
          typed_word_count: number
        }[]
      }
      get_practice_words: {
        Args: { p_session_id: string }
        Returns: {
          prompt_image_url: string
          prompt_text: string
          sort_order: number
          word_id: string
        }[]
      }
      get_practice_words_v2: {
        Args: { p_session_id: string }
        Returns: {
          autoplay_audio: boolean
          choices: Json
          input_mode: string
          play_audio: boolean
          prompt_image_url: string
          prompt_meaning: string
          prompt_question: string
          prompt_term: string
          show_chinese: boolean
          show_english: boolean
          source_sort_order: number
          word_id: string
        }[]
      }
      get_vocabulary_session_words_review: {
        Args: { p_session_id: string }
        Returns: {
          input_mode: string
          prompt_meaning: string
          prompt_question: string
          prompt_term: string
          source_sort_order: number
          word_id: string
        }[]
      }
      log_practice_session_tab_event: {
        Args: { p_event_type: string; p_session_id: string }
        Returns: undefined
      }
      publish_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      publish_pronunciation_task: {
        Args: { p_task_id: string }
        Returns: undefined
      }
      publish_vocabulary_set: { Args: { p_set_id: string }; Returns: undefined }
      purge_expired_upload_intents: {
        Args: { p_intent_ids: string[] }
        Returns: undefined
      }
      record_vocabulary_attempt: {
        Args: {
          p_session_id: string
          p_submitted_spelling: string
          p_word_id: string
        }
        Returns: {
          correct_answer: string
          is_correct: boolean
          was_already_recorded: boolean
        }[]
      }
      record_vocabulary_attempt_v2: {
        Args: {
          p_session_id: string
          p_submitted_spelling: string
          p_word_id: string
        }
        Returns: {
          attempt_no: number
          correct_answers: string[]
          is_correct: boolean
          was_already_recorded: boolean
        }[]
      }
      replace_vocabulary_word_alt_meanings: {
        Args: { p_alt_meanings: string[]; p_word_id: string }
        Returns: undefined
      }
      replace_vocabulary_word_alt_terms: {
        Args: { p_alt_terms: string[]; p_word_id: string }
        Returns: undefined
      }
      replace_vocabulary_word_choices: {
        Args: { p_choices: Json; p_word_id: string }
        Returns: undefined
      }
      set_practice_session_word_order: {
        Args: { p_session_id: string; p_word_order: string }
        Returns: undefined
      }
      start_practice_session: { Args: { p_set_id: string }; Returns: string }
      start_practice_session_v2: { Args: { p_set_id: string }; Returns: string }
      upgrade_vocabulary_set_to_v2: {
        Args: { p_set_id: string }
        Returns: undefined
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
    Enums: {},
  },
} as const
