import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, User, EyeOff } from "lucide-react";

export default function CourseCard({ course, categoryName }) {
  return (
    <Link to={`/course/${course.id}`} className={`course-card ${course.is_hidden ? "hidden-course" : ""}`}>
      <div className="course-cover">
        {course.cover_image
          ? <img src={course.cover_image} alt="" loading="lazy" />
          : <BookOpen className="book-icon" size={40} strokeWidth={1.3} />}
        {course.is_hidden ? <span className="cover-tag top"><EyeOff size={11} /> 已隐藏</span> : null}
        <span className="cover-tag bottom">{categoryName || "未分类"}</span>
      </div>
      <div className="course-title clamp-2">{course.title}</div>
      <div className="course-foot">
        <span className="who"><User size={12} /> <span className="ellipsis">{course.uploader_name}</span></span>
        <span className="count">{course.materials_count} 课时</span>
      </div>
    </Link>
  );
}
